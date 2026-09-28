jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { ImportSimulator } from '../imports/import-simulator';
import { StorageService } from '../uploads/storage.service';
import { http } from '../../test-utils/approvals-test-app';
import { UserRole } from '../users/user.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('GET /products/export (SP3, 3.3)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let token: string;
  let storage: FakeStorage;
  let queue: FakeQueue;

  beforeAll(async () => {
    ({ app, baseUrl, storage, queue } = await startImportsApp({ controllers: [ProductsController], providers: [ProductsService] }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Export');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  async function download(query: string, asToken = token) {
    const response = await fetch(`${baseUrl}/api/products/export${query}`, { headers: { Authorization: `Bearer ${asToken}` } });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  }

  async function sheetOf(body: Buffer): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as never);
    return workbook.getWorksheet('Produtos')!;
  }

  const names = (sheet: ExcelJS.Worksheet) =>
    sheet.getSheetValues().slice(2).map((row) => (row as ExcelJS.CellValue[])[2]);

  it('xlsx: cabeçalhos, código como texto, preço como número e nome protegido contra fórmula', async () => {
    await seedProduct({ companyId, barcode: '0789123', name: 'Arroz', unitPrice: 12.5, costPrice: 8 });
    await seedProduct({ companyId, barcode: '78912345678901', name: '=HYPERLINK("x")', unitPrice: 1 });
    const { status, headers, body } = await download('');
    expect(status).toBe(200);
    expect(headers.get('content-disposition')).toMatch(/^attachment; filename="produtos-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const sheet = await sheetOf(body);
    expect(sheet.getRow(1).values).toEqual([undefined, 'Código de barras', 'Nome', 'SKU', 'Preço de venda', 'Custo', 'Situação']);
    const rows = sheet.getSheetValues().slice(2) as ExcelJS.CellValue[][];
    const arroz = rows.find((row) => row[2] === 'Arroz')!;
    expect(arroz[1]).toBe('0789123');
    expect(arroz[4]).toBe(12.5);
    expect(arroz[5]).toBe(8);
    expect(arroz[6]).toBe('Ativo');
    expect(rows.find((row) => row[1] === '78912345678901')![2]).toBe('\'=HYPERLINK("x")');
    const row = rows.indexOf(arroz) + 2;
    expect(sheet.getCell(row, 1).numFmt).toBe('@');
    expect(sheet.getCell(row, 4).numFmt).toBe('0.00');
  });

  it('filtros da tela: padrão só ativos; archived; all com busca; nunca outra empresa', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Arroz' });
    const archived = await seedProduct({ companyId, barcode: '2', name: 'Arroz velho' });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archived]);
    await seedProduct({ companyId, barcode: '3', name: 'Feijão' });
    await seedProduct({ companyId: await seedCompany('Outra'), barcode: '4', name: 'Arroz da outra' });

    expect(names(await sheetOf((await download('')).body)).sort()).toEqual(['Arroz', 'Feijão']);
    const onlyArchived = await sheetOf((await download('?status=archived')).body);
    expect(names(onlyArchived)).toEqual(['Arroz velho']);
    expect((onlyArchived.getSheetValues()[2] as ExcelJS.CellValue[])[6]).toBe('Arquivado');
    expect(names(await sheetOf((await download('?status=all&q=arr')).body)).sort()).toEqual(['Arroz', 'Arroz velho']);
  });

  it('csv: BOM, ; e preço com vírgula', async () => {
    await seedProduct({ companyId, barcode: '0789', name: 'Arroz; tipo 1', unitPrice: 12.5 });
    const { status, headers, body } = await download('?format=csv');
    expect(status).toBe(200);
    expect(headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(headers.get('content-disposition')).toMatch(/filename="produtos-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(body.toString('utf8')).toBe(
      '﻿Código de barras;Nome;SKU;Preço de venda;Custo;Situação\r\n0789;"Arroz; tipo 1";;12,50;0,00;Ativo\r\n',
    );
  });

  it('mais de uma página (keyset de 2.000): 2.500 produtos ⇒ 2.500 linhas', async () => {
    await adminQuery(
      `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice")
       SELECT $1, lpad(g::text, 8, '0'), 'P' || g, 1, 1 FROM generate_series(1, 2500) g`,
      [companyId],
    );
    const text = (await download('?format=csv')).body.toString('utf8');
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2501);
    expect(new Set(lines).size).toBe(2501);
  });

  it('funcionário ⇒ 403; formato inválido ⇒ 400', async () => {
    const employee = await seedUser(companyId, 'employee');
    expect((await download('', await tokenFor(employee, companyId, UserRole.EMPLOYEE))).status).toBe(403);
    expect((await download('?format=pdf')).status).toBe(400);
  });

  it('o xlsx exportado volta na importação com todas as colunas sugeridas', async () => {
    await seedProduct({ companyId, barcode: '0789123', name: 'Arroz', unitPrice: 12.5 });
    const { body } = await download('');
    const { status, body: uploaded } = await uploadFile(baseUrl, token, body, 'produtos.xlsx');
    expect(status).toBe(201);
    expect(uploaded.suggestedMapping).toEqual({
      barcode: 'Código de barras',
      name: 'Nome',
      sku: 'SKU',
      unitPrice: 'Preço de venda',
      costPrice: 'Custo',
    });
    expect(uploaded.sample[0][0]).toBe('0789123');
  });

  it('ida e volta: nomes que começam com - + = @ exportados e reimportados ficam "Sem mudança"', async () => {
    await seedProduct({ companyId, barcode: '111', name: '-10% Sabão', unitPrice: 5 });
    await seedProduct({ companyId, barcode: '222', name: '+Vida Suco', unitPrice: 6 });
    await seedProduct({ companyId, barcode: '333', name: '@Home Toalha', unitPrice: 7 });
    const { body } = await download('');
    const { body: uploaded } = await uploadFile(baseUrl, token, body, 'produtos.xlsx');
    await http(baseUrl, 'POST', `/api/imports/${uploaded.job.id}/simulate`, token, {
      mapping: uploaded.suggestedMapping,
      updateFields: ['name', 'sku', 'unitPrice', 'costPrice'],
    });
    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(
      queue.calls[queue.calls.length - 1].data,
    );
    const [job] = await adminQuery(`SELECT status, summary FROM import_jobs WHERE id = $1`, [uploaded.job.id]);
    expect(job.status).toBe('simulated');
    expect(job.summary.counts).toMatchObject({ unchanged: 3, update: 0, create: 0, error: 0 });
  });
});

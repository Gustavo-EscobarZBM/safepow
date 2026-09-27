jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { Job } from 'bullmq';
import * as ExcelJS from 'exceljs';
import { http, seedUser, setPolicies, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { xlsxBuffer } from './engine/test-fixtures';
import { ImportsController } from './imports.controller';
import { ImportsQueueProcessor } from './imports-queue.processor';

describe('Endpoint antigo pelo motor novo, histórico, modelo e limpeza (SP3, 3.1.2)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let queue: FakeQueue;
  let companyId: string;
  let managerId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl, storage, queue } = await startImportsApp({ controllers: [ImportsController] }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    queue.calls.length = 0;
    companyId = await seedCompany('Empresa Legado');
    managerId = await seedUser(companyId, 'manager', { name: 'Gerente Um' });
    token = await tokenFor(managerId, companyId);
  });

  /** Processa as mensagens da fila como o worker faria (simulate ⇒ auto-apply). */
  async function drainQueue(): Promise<void> {
    const processor = new ImportsQueueProcessor(await appDataSource(), storage as unknown as StorageService);
    while (queue.calls.length) {
      const call = queue.calls.shift()!;
      await processor.process({ name: call.name, data: call.data } as Job);
    }
  }

  async function legacyUpload(rows: unknown[][], mapping: Record<string, string>) {
    const form = new FormData();
    form.append('file', new Blob([await xlsxBuffer({ Produtos: rows })]), 'antigo.xlsx');
    form.append('mapping', JSON.stringify(mapping));
    const response = await fetch(`${baseUrl}/api/products/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  const MAPPING = { barcodeColumn: 'Codigo', nameColumn: 'Nome', unitPriceColumn: 'Preco' };

  it('tela antiga: sobe, processa e termina completed; preço com source import; arquivado reativado', async () => {
    const productId = await seedProduct({ companyId, barcode: '8001', unitPrice: 10 });
    const archived = await seedProduct({ companyId, barcode: '8101', unitPrice: 5 });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archived]);

    const { status, body } = await legacyUpload(
      [
        ['Codigo', 'Nome', 'Preco'],
        ['8001', 'Produto Importado', 15],
        ['8101', 'Voltou', 5],
        ['8201', 'Novo', 3],
      ],
      MAPPING,
    );
    expect(status).toBe(201);
    expect(body.jobId).toEqual(expect.any(String));
    await drainQueue();

    const job = await http(baseUrl, 'GET', `/api/products/import/${body.jobId}`, token);
    expect(job.body).toMatchObject({ id: body.jobId, status: 'completed', successCount: 3, errorCount: 0, fileName: 'antigo.xlsx' });
    const [history] = await adminQuery(
      `SELECT "unitPrice", source FROM product_price_history WHERE "productId" = $1 ORDER BY seq DESC LIMIT 1`,
      [productId],
    );
    expect(history).toEqual({ unitPrice: '15.00', source: 'import' });
    expect((await adminQuery(`SELECT "isActive" FROM products WHERE id = $1`, [archived]))[0].isActive).toBe(true);
  });

  it('tela antiga: enquanto processa, status processing', async () => {
    const { body } = await legacyUpload([['Codigo', 'Nome', 'Preco'], ['1', 'A', 1]], MAPPING);
    expect((await http(baseUrl, 'GET', `/api/products/import/${body.jobId}`, token)).body.status).toBe('processing');
  });

  it('tela antiga: coluna do mapeamento que não existe ⇒ 400 na hora', async () => {
    const { status } = await legacyUpload([['Codigo', 'Nome']], { ...MAPPING, unitPriceColumn: 'Valor' });
    expect(status).toBe(400);
  });

  it('tela antiga: mudança que exige aprovação ⇒ failed com a mensagem e nada gravado', async () => {
    await seedProduct({ companyId, barcode: '8001', unitPrice: 10 });
    await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } });
    const { body } = await legacyUpload([['Codigo', 'Nome', 'Preco'], ['8001', 'X', 50]], MAPPING);
    await drainQueue();
    const job = (await http(baseUrl, 'GET', `/api/products/import/${body.jobId}`, token)).body;
    expect(job.status).toBe('failed');
    expect(job.errorReport).toEqual([
      { row: 0, error: 'Esta importação precisa de justificativa/aprovação. Use a nova tela de importação.' },
    ]);
    expect((await adminQuery(`SELECT "unitPrice" FROM products WHERE barcode = '8001'`))[0].unitPrice).toBe('10.00');
  });

  it('GET /imports lista as importações da empresa, mais novas primeiro, com o autor', async () => {
    const first = (await uploadFile(baseUrl, token, await xlsxBuffer({ A: [['EAN', 'Nome'], ['1', 'X']] }), 'a.xlsx')).body.job.id;
    const second = (await uploadFile(baseUrl, token, await xlsxBuffer({ A: [['EAN', 'Nome'], ['2', 'Y']] }), 'b.xlsx')).body.job.id;
    const other = await seedCompany('Outra');
    await adminQuery(`INSERT INTO import_jobs ("companyId", "fileName", "storageKey") VALUES ($1, 'x', 'k')`, [other]);

    const { status, body } = await http(baseUrl, 'GET', '/api/imports?resource=products&page=1&limit=10', token);
    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([second, first]);
    expect(body.items[0].createdByName).toBe('Gerente Um');
  });

  it('modelo .xlsx com os cabeçalhos canônicos, coluna do código como texto, e que reimporta sem mapear', async () => {
    const response = await fetch(`${baseUrl}/api/imports/template?resource=products`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml');
    const buffer = Buffer.from(await response.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(['Código de barras', 'Nome', 'SKU', 'Preço de venda', 'Custo']);
    expect(sheet.getColumn(1).numFmt).toBe('@');

    const { body } = await uploadFile(baseUrl, token, buffer, 'modelo.xlsx');
    expect(Object.keys(body.suggestedMapping).sort()).toEqual(['barcode', 'costPrice', 'name', 'sku', 'unitPrice']);
  });

  it('limpeza: linhas de preparação com mais de 30 dias somem; job parado há mais de 7 dias é cancelado', async () => {
    const old = await adminQuery(
      `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status, "createdAt", "appliedAt", summary)
       VALUES ($1, 'velho.xlsx', 'k', 'completed', now() - interval '40 days', now() - interval '31 days', '{}') RETURNING id`,
      [companyId],
    );
    await adminQuery(`INSERT INTO import_rows ("companyId", "jobId", "rowNumber", action) VALUES ($1, $2, 2, 'create')`, [
      companyId,
      old[0].id,
    ]);
    const stale = await adminQuery(
      `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status, "createdAt")
       VALUES ($1, 'parado.xlsx', 'k', 'simulated', now() - interval '8 days') RETURNING id`,
      [companyId],
    );

    await http(baseUrl, 'GET', '/api/imports?resource=products', token);

    expect(await adminQuery(`SELECT 1 FROM import_rows WHERE "jobId" = $1`, [old[0].id])).toHaveLength(0);
    expect((await adminQuery(`SELECT summary FROM import_jobs WHERE id = $1`, [old[0].id]))[0].summary.rowsPurged).toBe(true);
    expect((await adminQuery(`SELECT status FROM import_jobs WHERE id = $1`, [stale[0].id]))[0].status).toBe('cancelled');
  });
});

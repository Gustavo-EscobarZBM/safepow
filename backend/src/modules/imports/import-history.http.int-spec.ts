jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { http, seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { xlsxBuffer } from './engine/test-fixtures';

describe('Histórico, modelo e limpeza de importações (SP3)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let queue: FakeQueue;
  let companyId: string;
  let managerId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl, queue } = await startImportsApp());
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

  it('o endpoint antigo POST /products/import não existe mais ⇒ 404', async () => {
    const form = new FormData();
    form.append('file', new Blob([await xlsxBuffer({ Produtos: [['Codigo', 'Nome']] })]), 'antigo.xlsx');
    const response = await fetch(`${baseUrl}/api/products/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(response.status).toBe(404);
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

  it('limpeza: gravação que falhou há mais de 30 dias é cancelada antes de perder as linhas; em andamento não perde linhas', async () => {
    const failed = await adminQuery(
      `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status, "createdAt", options, summary)
       VALUES ($1, 'falhou.xlsx', 'k', 'failed', now() - interval '40 days', $2::jsonb, '{}') RETURNING id`,
      [companyId, JSON.stringify({ applyStartedAt: '2026-08-01T00:00:00Z' })],
    );
    const applying = await adminQuery(
      `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status, "createdAt", summary)
       VALUES ($1, 'rodando.xlsx', 'k', 'applying', now() - interval '40 days', '{}') RETURNING id`,
      [companyId],
    );
    for (const id of [failed[0].id, applying[0].id]) {
      await adminQuery(`INSERT INTO import_rows ("companyId", "jobId", "rowNumber", action) VALUES ($1, $2, 2, 'create')`, [companyId, id]);
    }

    await http(baseUrl, 'GET', '/api/imports?resource=products', token);

    expect((await adminQuery(`SELECT status FROM import_jobs WHERE id = $1`, [failed[0].id]))[0].status).toBe('cancelled');
    expect(await adminQuery(`SELECT 1 FROM import_rows WHERE "jobId" = $1`, [failed[0].id])).toHaveLength(0);
    expect(await adminQuery(`SELECT 1 FROM import_rows WHERE "jobId" = $1`, [applying[0].id])).toHaveLength(1);
  });
});

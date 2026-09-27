jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { http, seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { ImportApplier } from './import-applier';
import { ImportSimulator } from './import-simulator';

const TOTAL = 50_000;
const EXISTING = 10_000;
const PHASE_BUDGET_MS = 180_000;

const barcode = (i: number) => `789${String(i).padStart(10, '0')}`;

/** Carga do "pronto quando" do SP3: 50 mil linhas com custo terminam em poucos minutos (spec 8). */
describe('Carga da importação: 50 mil linhas (SP3, 3.1.2)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let queue: FakeQueue;

  beforeAll(async () => {
    ({ app, baseUrl, storage, queue } = await startImportsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });

  it(`simula e grava ${TOTAL} linhas (${EXISTING} existentes) dentro do orçamento`, async () => {
    await truncateAll();
    const companyId = await seedCompany('Empresa Carga');
    const managerId = await seedUser(companyId);
    const token = await tokenFor(managerId, companyId);
    await adminQuery(
      `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice")
       SELECT $1, '789' || lpad(i::text, 10, '0'), 'Produto ' || i, 10, 6 FROM generate_series(0, $2 - 1) AS i`,
      [companyId, EXISTING],
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Produtos');
    sheet.getColumn(1).numFmt = '@';
    sheet.addRow(['Código de barras', 'Nome', 'Preço de venda', 'Custo']);
    for (let i = 0; i < TOTAL; i++) sheet.addRow([barcode(i), `Produto ${i}`, 12.5, 7.25]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { body } = await uploadFile(baseUrl, token, buffer, 'carga.xlsx');
    const jobId = body.job.id;
    await http(baseUrl, 'POST', `/api/imports/${jobId}/simulate`, token, {
      mapping: body.suggestedMapping,
      updateFields: ['name', 'unitPrice', 'costPrice'],
    });

    const simStart = Date.now();
    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(queue.calls[0].data);
    const simMs = Date.now() - simStart;
    const [simulated] = await adminQuery(`SELECT status, summary FROM import_jobs WHERE id = $1`, [jobId]);
    expect(simulated.status).toBe('simulated');
    expect(simulated.summary.counts).toMatchObject({ create: TOTAL - EXISTING, update: EXISTING });

    queue.calls.length = 0;
    await http(baseUrl, 'POST', `/api/imports/${jobId}/apply`, token, {});
    const applyStart = Date.now();
    await new ImportApplier(await appDataSource()).run(queue.calls[0].data);
    const applyMs = Date.now() - applyStart;

    const [done] = await adminQuery(`SELECT status, "successCount" FROM import_jobs WHERE id = $1`, [jobId]);
    expect(done).toEqual({ status: 'completed', successCount: TOTAL });
    const [{ n, cost }] = await adminQuery(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE "costPrice" = 7.25)::int AS cost FROM products WHERE "companyId" = $1`,
      [companyId],
    );
    expect(n).toBe(TOTAL);
    expect(cost).toBe(TOTAL);

    console.log(`[carga SP3] ${TOTAL} linhas — simulação ${(simMs / 1000).toFixed(1)} s, gravação ${(applyMs / 1000).toFixed(1)} s`);
    expect(simMs).toBeLessThan(PHASE_BUDGET_MS);
    expect(applyMs).toBeLessThan(PHASE_BUDGET_MS);
  }, 900_000);
});

jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedLoss, seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { xlsxBuffer } from './engine/test-fixtures';
import { ImportApplier } from './import-applier';
import { ImportSimulator } from './import-simulator';

const MAPPING = { barcode: 'EAN', name: 'Descrição', unitPrice: 'Preço' };
const ROWS: unknown[][] = [
  ['EAN', 'Descrição', 'Preço'],
  ['1234567', 'Novo', '3,00'], // 2 create
  ['100', 'Arroz', '12,00'], // 3 update
  ['200', 'Feijão', '7,00'], // 4 reactivate
  ['300', 'Óleo', '5,00'], // 5 unchanged
  ['600', '', '1'], // 6 erro
  ['700', 'Leite', 'abc'], // 7 erro
  [],
  ['1234567', 'Novo', '3,00'], // 9 duplicate
  ['100', 'Arroz', '99'], // 10 erro
];

describe('Gravação da importação (SP3, 3.1.2)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let queue: FakeQueue;
  let companyId: string;
  let managerId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl, storage, queue } = await startImportsApp());
  });
  afterAll(async () => {
    await adminQuery(`DROP TRIGGER IF EXISTS trg_test_fail ON products`);
    await adminQuery(`DROP FUNCTION IF EXISTS test_fail()`);
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    queue.calls.length = 0;
    companyId = await seedCompany('Empresa Gravação');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
  });

  const product = async (barcode: string) =>
    (await adminQuery(`SELECT id, name, "unitPrice", "isActive", "updatedAt" FROM products WHERE "companyId" = $1 AND barcode = $2`, [
      companyId,
      barcode,
    ]))[0];

  async function seedCatalog(): Promise<void> {
    await seedProduct({ companyId, barcode: '100', name: 'Arroz', unitPrice: 10 });
    const bean = await seedProduct({ companyId, barcode: '200', name: 'Feijão', unitPrice: 7 });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [bean]);
    await seedProduct({ companyId, barcode: '300', name: 'Óleo', unitPrice: 5 });
    const missing = await seedProduct({ companyId, barcode: '400', name: 'Sal', unitPrice: 2 });
    await seedLoss(companyId, missing, managerId);
    await seedProduct({ companyId, barcode: '700', name: 'Leite', unitPrice: 4 });
  }

  /** Sobe a planilha, simula e deixa o job pronto para a gravação (status applying com applyRunId). */
  async function simulated(rows: unknown[][] = ROWS, updateFields = ['name', 'unitPrice'], mapping = MAPPING): Promise<string> {
    const { body } = await uploadFile(baseUrl, token, await xlsxBuffer({ Produtos: rows }), 'erp.xlsx');
    const jobId = body.job.id;
    await http(baseUrl, 'POST', `/api/imports/${jobId}/simulate`, token, { mapping, updateFields });
    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(queue.calls[queue.calls.length - 1].data);
    return jobId;
  }

  async function readyToApply(jobId: string, runId = 'r1', options: Record<string, unknown> = {}): Promise<void> {
    await adminQuery(`UPDATE import_jobs SET status = 'applying', options = options || $2::jsonb WHERE id = $1`, [
      jobId,
      JSON.stringify({ applyRunId: runId, applyStartedAt: new Date().toISOString(), ...options }),
    ]);
  }

  const applier = async (limits?: ConstructorParameters<typeof ImportApplier>[1]) => new ImportApplier(await appDataSource(), limits);
  const job = async (jobId: string) => (await adminQuery(`SELECT * FROM import_jobs WHERE id = $1`, [jobId]))[0];

  it('grava create/update/reactivate, deixa unchanged intacto e guarda o antes', async () => {
    await seedCatalog();
    const oilBefore = await product('300');
    const jobId = await simulated();
    await readyToApply(jobId);

    await (await applier()).run({ jobId, companyId, runId: 'r1' });

    const done = await job(jobId);
    expect(done).toMatchObject({ status: 'completed', successCount: 4 });
    expect(done.appliedAt).not.toBeNull();
    expect(done.summary.appliedCount).toBe(4);
    expect(await product('1234567')).toMatchObject({ name: 'Novo', unitPrice: '3.00', isActive: true });
    expect((await product('100')).unitPrice).toBe('12.00');
    expect((await product('200')).isActive).toBe(true);
    expect((await product('300')).updatedAt).toEqual(oilBefore.updatedAt);

    const rows = await adminQuery(
      `SELECT "rowNumber", "appliedAction", "appliedAt", "appliedUpdatedAt", before, "productId" FROM import_rows WHERE "jobId" = $1 ORDER BY "rowNumber"`,
      [jobId],
    );
    const byRow = new Map<number, any>(rows.map((r: { rowNumber: number }) => [r.rowNumber, r]));
    expect(byRow.get(3)).toMatchObject({ appliedAction: 'update', before: expect.objectContaining({ unitPrice: 10, isActive: true }) });
    expect(byRow.get(3).appliedUpdatedAt).toEqual((await product('100')).updatedAt);
    expect(byRow.get(2)).toMatchObject({ appliedAction: 'create', before: null, productId: (await product('1234567')).id });
    expect(byRow.get(5).appliedAction).toBe('unchanged');
    for (const n of [6, 7, 9, 10]) expect(byRow.get(n).appliedAt).toBeNull();
  });

  it('histórico de preço com source import e autor; auditoria só com o evento resumido', async () => {
    await seedCatalog();
    const jobId = await simulated();
    await readyToApply(jobId);
    await (await applier()).run({ jobId, companyId, runId: 'r1' });

    const { id } = await product('100');
    const [last] = await adminQuery(
      `SELECT source, "changedByUserId" FROM product_price_history WHERE "productId" = $1 ORDER BY seq DESC LIMIT 1`,
      [id],
    );
    expect(last).toEqual({ source: 'import', changedByUserId: managerId });
    expect(await adminQuery(`SELECT 1 FROM audit_log WHERE "entityId" = $1 AND action = 'update'`, [id])).toHaveLength(0);
    const events = await adminQuery(`SELECT summary, "actorUserId" FROM audit_log WHERE "entityId" = $1 AND action = 'import'`, [jobId]);
    expect(events).toHaveLength(1);
    expect(events[0].actorUserId).toBe(managerId);
    expect(events[0].summary).toMatchObject({ status: 'completed', created: 1, updated: 1, reactivated: 1, unchanged: 1, archived: 0, errors: 3 });
  });

  it('campo fora de updateFields e valor não informado nunca mudam o produto', async () => {
    await seedProduct({ companyId, barcode: '100', name: 'Arroz', unitPrice: 10, costPrice: 6 });
    const jobId = await simulated(
      [
        ['EAN', 'Descrição', 'Preço', 'Custo'],
        ['100', 'Outro nome', '12,00', ''],
      ],
      ['unitPrice', 'costPrice'],
      { ...MAPPING, costPrice: 'Custo' } as typeof MAPPING,
    );
    await readyToApply(jobId);
    await (await applier()).run({ jobId, companyId, runId: 'r1' });
    const [row] = await adminQuery(`SELECT name, "unitPrice", "costPrice" FROM products WHERE barcode = '100'`);
    expect(row).toEqual({ name: 'Arroz', unitPrice: '12.00', costPrice: '6.00' });
  });

  it('catálogo mudou entre a simulação e a gravação: recalcula contra o estado atual', async () => {
    await seedCatalog();
    const jobId = await simulated();
    await adminQuery(`UPDATE products SET "unitPrice" = 12 WHERE barcode = '100' AND "companyId" = $1`, [companyId]);
    await adminQuery(`UPDATE products SET "isActive" = false WHERE barcode = '300' AND "companyId" = $1`, [companyId]);
    await seedProduct({ companyId, barcode: '1234567', name: 'Novo', unitPrice: 3 });
    await readyToApply(jobId);

    await (await applier()).run({ jobId, companyId, runId: 'r1' });

    expect((await job(jobId)).status).toBe('completed');
    const actions = await adminQuery(`SELECT key, "appliedAction" FROM import_rows WHERE "jobId" = $1 AND "appliedAt" IS NOT NULL`, [jobId]);
    expect(Object.fromEntries(actions.map((a: { key: string; appliedAction: string }) => [a.key, a.appliedAction]))).toEqual({
      '1234567': 'unchanged',
      '100': 'unchanged',
      '200': 'reactivate',
      '300': 'reactivate',
    });
    expect(await adminQuery(`SELECT 1 FROM products WHERE barcode = '1234567'`)).toHaveLength(1);
  });

  it('arquivar ausentes arquiva e guarda o antes', async () => {
    await seedCatalog();
    const jobId = await simulated();
    await readyToApply(jobId, 'r1', { archiveMissing: true });
    await (await applier()).run({ jobId, companyId, runId: 'r1' });

    expect((await product('400')).isActive).toBe(false);
    const [row] = await adminQuery(`SELECT key, before, "appliedAction", "appliedAt" FROM import_rows WHERE "jobId" = $1 AND action = 'archive'`, [
      jobId,
    ]);
    expect(row).toMatchObject({ key: '400', appliedAction: 'archive', before: expect.objectContaining({ isActive: true }) });
    expect(row.appliedAt).not.toBeNull();
    const [archivedRow] = await adminQuery(`SELECT "appliedUpdatedAt" FROM import_rows WHERE "jobId" = $1 AND action = 'archive'`, [jobId]);
    expect(archivedRow.appliedUpdatedAt).toEqual((await product('400')).updatedAt);
    const [event] = await adminQuery(`SELECT summary FROM audit_log WHERE "entityId" = $1 AND action = 'import'`, [jobId]);
    expect(event.summary.archived).toBe(1);
  });

  it('ausentes cresceram além do confirmado ⇒ failed antes de gravar qualquer coisa', async () => {
    await seedCatalog();
    const jobId = await simulated();
    await seedProduct({ companyId, barcode: '800', name: 'Novo ausente', unitPrice: 1 });
    await readyToApply(jobId, 'r1', { archiveMissing: true, confirmArchiveCount: 1 });
    await (await applier()).run({ jobId, companyId, runId: 'r1' });

    expect(await job(jobId)).toMatchObject({
      status: 'failed',
      lastError: 'O número de produtos ausentes mudou (era 1, agora 2). Simule de novo.',
    });
    expect((await product('100')).unitPrice).toBe('10.00');
  });

  it('falha no meio: lotes anteriores ficam; rodar de novo continua sem regravar', async () => {
    await seedCatalog();
    const jobId = await simulated();
    await readyToApply(jobId);
    await adminQuery(`
      CREATE OR REPLACE FUNCTION test_fail() RETURNS trigger AS $$
      BEGIN IF NEW.barcode = '200' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await adminQuery(`CREATE TRIGGER trg_test_fail BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION test_fail()`);
    try {
      await (await applier({ batchSize: 2 })).run({ jobId, companyId, runId: 'r1' });
    } finally {
      await adminQuery(`DROP TRIGGER IF EXISTS trg_test_fail ON products`);
    }

    const failed = await job(jobId);
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toContain('falha simulada');
    expect((await product('100')).unitPrice).toBe('12.00');
    const firstBatch = await adminQuery(`SELECT "rowNumber", "appliedAt" FROM import_rows WHERE "jobId" = $1 AND "rowNumber" IN (2, 3) ORDER BY 1`, [
      jobId,
    ]);
    expect(firstBatch.every((r: { appliedAt: Date | null }) => r.appliedAt)).toBe(true);

    await readyToApply(jobId, 'r2');
    await (await applier({ batchSize: 2 })).run({ jobId, companyId, runId: 'r2' });
    expect((await job(jobId)).status).toBe('completed');
    expect((await product('200')).isActive).toBe(true);
    const again = await adminQuery(`SELECT "rowNumber", "appliedAt" FROM import_rows WHERE "jobId" = $1 AND "rowNumber" IN (2, 3) ORDER BY 1`, [jobId]);
    expect(again).toEqual(firstBatch);
  });

  it('mensagem velha (outro applyRunId) não faz nada', async () => {
    await seedCatalog();
    const jobId = await simulated();
    await readyToApply(jobId, 'r2');
    await (await applier()).run({ jobId, companyId, runId: 'r1' });
    expect((await job(jobId)).status).toBe('applying');
    expect((await product('100')).unitPrice).toBe('10.00');
  });

  it('mesma mensagem entregue duas vezes ao mesmo tempo: uma só grava', async () => {
    await seedCatalog();
    const jobId = await simulated();
    await readyToApply(jobId);
    const releases: (() => void)[] = [];
    let arrived = 0;
    let bothArrived!: () => void;
    const bothAtGate = new Promise<void>((resolve) => (bothArrived = resolve));
    const beforeBatch = async () => {
      if (releases.length >= 2) return;
      arrived += 1;
      if (arrived === 2) bothArrived();
      await new Promise<void>((resolve) => releases.push(resolve));
    };
    const runs = Promise.all([(await applier({ beforeBatch })).run({ jobId, companyId, runId: 'r1' }), (await applier({ beforeBatch })).run({ jobId, companyId, runId: 'r1' })]);
    await bothAtGate;
    releases.forEach((release) => release());
    await runs;

    expect((await job(jobId)).status).toBe('completed');
    expect(await adminQuery(`SELECT 1 FROM audit_log WHERE "entityId" = $1 AND action = 'import'`, [jobId])).toHaveLength(1);
    expect((await job(jobId)).summary.appliedCount).toBe(4);
  });
});

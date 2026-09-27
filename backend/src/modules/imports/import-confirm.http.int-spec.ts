jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedLoss, seedUser, setPolicies, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { xlsxBuffer } from './engine/test-fixtures';
import { ImportApplier } from './import-applier';
import { ImportSimulator } from './import-simulator';

const MAPPING = { barcode: 'EAN', name: 'Descrição', unitPrice: 'Preço' };
const ROWS: unknown[][] = [
  ['EAN', 'Descrição', 'Preço'],
  ['1234567', 'Novo', '3,00'],
  ['100', 'Arroz', '12,00'],
  ['300', 'Óleo', '5,00'],
];

describe('Confirmação da importação (SP3, 3.1.2)', () => {
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
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    queue.calls.length = 0;
    companyId = await seedCompany('Empresa Confirmação');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
    await seedProduct({ companyId, barcode: '100', name: 'Arroz', unitPrice: 10 });
    await seedProduct({ companyId, barcode: '300', name: 'Óleo', unitPrice: 5 });
    const missing = await seedProduct({ companyId, barcode: '400', name: 'Sal', unitPrice: 2 });
    await seedLoss(companyId, missing, managerId);
  });

  async function simulated(rows: unknown[][] = ROWS, asToken = token): Promise<string> {
    const { body } = await uploadFile(baseUrl, asToken, await xlsxBuffer({ Produtos: rows }), 'erp.xlsx');
    await http(baseUrl, 'POST', `/api/imports/${body.job.id}/simulate`, asToken, { mapping: MAPPING, updateFields: ['name', 'unitPrice'] });
    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(queue.calls[queue.calls.length - 1].data);
    queue.calls.length = 0;
    return body.job.id;
  }

  const apply = (jobId: string, body: Record<string, unknown> = {}, asToken = token) =>
    http(baseUrl, 'POST', `/api/imports/${jobId}/apply`, asToken, body);
  const job = async (jobId: string) => (await adminQuery(`SELECT * FROM import_jobs WHERE id = $1`, [jobId]))[0];

  it('confirma: applying, enfileira apply após a resposta e a gravação conclui', async () => {
    const jobId = await simulated();
    const { status, body } = await apply(jobId);
    expect(status).toBe(202);
    expect(body.job.status).toBe('applying');
    const saved = await job(jobId);
    expect(saved.options.applyStartedAt).toEqual(expect.any(String));
    expect(queue.calls).toEqual([
      expect.objectContaining({ name: 'apply', data: { jobId, companyId, runId: saved.options.applyRunId } }),
    ]);
    await new ImportApplier(await appDataSource()).run(queue.calls[0].data);
    expect((await job(jobId)).status).toBe('completed');
  });

  it.each(['uploaded', 'simulating', 'completed'])('confirmar job em %s ⇒ 409 INVALID_STATE', async (state) => {
    const jobId = await simulated();
    await adminQuery(`UPDATE import_jobs SET status = $2 WHERE id = $1`, [jobId, state]);
    const { status, body } = await apply(jobId);
    expect(status).toBe(409);
    expect(body.errorCode).toBe('INVALID_STATE');
  });

  it('outra importação da empresa em andamento ⇒ 409 IMPORT_IN_PROGRESS; de outra empresa não bloqueia', async () => {
    const first = await simulated();
    const second = await simulated();
    await adminQuery(`UPDATE import_jobs SET status = 'applying' WHERE id = $1`, [first]);
    const { status, body } = await apply(second);
    expect(status).toBe(409);
    expect(body).toMatchObject({
      errorCode: 'IMPORT_IN_PROGRESS',
      message: 'Já existe uma importação em andamento. Aguarde terminar ou cancele-a.',
    });

    await adminQuery(`UPDATE import_jobs SET status = 'cancelled' WHERE id = $1`, [first]);
    const other = await seedCompany('Outra');
    await adminQuery(`INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status) VALUES ($1, 'x', 'k', 'applying')`, [other]);
    expect((await apply(second)).status).toBe(202);
  });

  it('duplo clique: duas confirmações simultâneas ⇒ uma 202 e uma 409', async () => {
    const jobId = await simulated();
    const results = await Promise.all([apply(jobId), apply(jobId)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(queue.calls).toHaveLength(1);
  });

  it('arquivar ausentes acima de 20% exige digitar o número', async () => {
    const jobId = await simulated();
    const without = await apply(jobId, { archiveMissing: true });
    expect(without.status).toBe(409);
    expect(without.body).toMatchObject({ errorCode: 'ARCHIVE_CONFIRMATION_REQUIRED', missingCount: 1 });

    const wrong = await apply(jobId, { archiveMissing: true, confirmArchiveCount: 2 });
    expect(wrong.status).toBe(409);

    const ok = await apply(jobId, { archiveMissing: true, confirmArchiveCount: 1 });
    expect(ok.status).toBe(202);
    expect((await job(jobId)).options).toMatchObject({ archiveMissing: true, confirmArchiveCount: 1 });
  });

  it('arquivar ausentes até 20% não exige confirmação', async () => {
    for (const barcode of ['501', '502', '503', '504']) await seedProduct({ companyId, barcode, name: `P${barcode}`, unitPrice: 1 });
    const rows = [...ROWS, ...['501', '502', '503', '504'].map((b) => [b, `P${b}`, '1,00'])];
    const jobId = await simulated(rows);
    expect((await apply(jobId, { archiveMissing: true })).status).toBe(202);
  });

  describe('políticas de aprovação', () => {
    beforeEach(() => setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } }));

    it('1 gerente: exige justificativa e grava com o evento justify', async () => {
      const jobId = await simulated();
      const missing = await apply(jobId);
      expect(missing.status).toBe(409);
      expect(missing.body).toMatchObject({ errorCode: 'JUSTIFICATION_REQUIRED', mode: 'justification', policy: 'price_change' });

      const ok = await apply(jobId, { justification: 'Tabela nova do fornecedor' });
      expect(ok.status).toBe(202);
      expect(ok.body.job.status).toBe('applying');
      const events = await adminQuery(`SELECT reason FROM audit_log WHERE "entityId" = $1 AND action = 'justify' AND "entityType" = 'import_job'`, [
        jobId,
      ]);
      expect(events).toEqual([{ reason: 'Tabela nova do fornecedor' }]);
    });

    it('2 gerentes: vira um pedido de aprovação e nada é enfileirado', async () => {
      await seedUser(companyId);
      const jobId = await simulated();
      const { status, body } = await apply(jobId, { justification: 'Tabela nova' });
      expect(status).toBe(202);
      expect(body).toMatchObject({ status: 'pending', changeRequestId: expect.any(String), job: { status: 'pending_approval' } });
      const saved = await job(jobId);
      expect(saved.changeRequestId).toBe(body.changeRequestId);
      const [request] = await adminQuery(`SELECT policy, "entityType", "entityId", operation, snapshot FROM change_requests WHERE id = $1`, [
        body.changeRequestId,
      ]);
      expect(request).toEqual({
        policy: 'price_change',
        entityType: 'import_job',
        entityId: jobId,
        operation: 'import',
        snapshot: { jobId, simulatedAt: saved.simulatedAt.toISOString(), status: 'pending_approval' },
      });
      expect(queue.calls).toHaveLength(0);
    });

    it('política ligada DEPOIS da simulação ainda vale na confirmação', async () => {
      await setPolicies(companyId, {});
      const jobId = await simulated();
      await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } });
      expect((await apply(jobId)).body.errorCode).toBe('JUSTIFICATION_REQUIRED');
    });
  });

  it('archive_with_history: arquivar ausente com perdas vira pedido dessa política', async () => {
    await seedUser(companyId);
    await setPolicies(companyId, { archive_with_history: { enabled: true } });
    const jobId = await simulated();
    const { body } = await apply(jobId, { archiveMissing: true, confirmArchiveCount: 1, justification: 'Descontinuados' });
    expect(body.status).toBe('pending');
    const [request] = await adminQuery(`SELECT policy FROM change_requests WHERE id = $1`, [body.changeRequestId]);
    expect(request.policy).toBe('archive_with_history');
  });

  it('tentar de novo: só gravação que falhou; enfileira com outro applyRunId', async () => {
    const jobId = await simulated();
    await apply(jobId);
    const firstRun = (await job(jobId)).options.applyRunId;
    await adminQuery(`UPDATE import_jobs SET status = 'failed', "lastError" = 'x' WHERE id = $1`, [jobId]);
    queue.calls.length = 0;

    const { status, body } = await http(baseUrl, 'POST', `/api/imports/${jobId}/retry`, token);
    expect(status).toBe(202);
    expect(body.job.status).toBe('applying');
    const saved = await job(jobId);
    expect(saved.options.applyRunId).not.toBe(firstRun);
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0].data.runId).toBe(saved.options.applyRunId);

    const simFailed = await simulated();
    await adminQuery(`UPDATE import_jobs SET status = 'failed' WHERE id = $1`, [simFailed]);
    await adminQuery(`UPDATE import_jobs SET status = 'cancelled' WHERE id = $1`, [jobId]);
    expect((await http(baseUrl, 'POST', `/api/imports/${simFailed}/retry`, token)).status).toBe(409);
  });

  it('cancelar: simulated e pending_approval (cancela o pedido); applying ⇒ 409', async () => {
    const jobId = await simulated();
    expect((await http(baseUrl, 'POST', `/api/imports/${jobId}/cancel`, token)).body.job.status).toBe('cancelled');

    await seedUser(companyId);
    await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } });
    const pending = await simulated();
    const { body } = await apply(pending, { justification: 'x' });
    expect((await http(baseUrl, 'POST', `/api/imports/${pending}/cancel`, token)).status).toBe(201);
    expect((await job(pending)).status).toBe('cancelled');
    const [request] = await adminQuery(`SELECT status FROM change_requests WHERE id = $1`, [body.changeRequestId]);
    expect(request.status).toBe('cancelled');

    await setPolicies(companyId, {});
    const applying = await simulated();
    await apply(applying);
    const { status, body: error } = await http(baseUrl, 'POST', `/api/imports/${applying}/cancel`, token);
    expect(status).toBe(409);
    expect(error.errorCode).toBe('INVALID_STATE');
  });

  it('cancelar simulação travada (simulating sem worker): cancela, libera a empresa e a mensagem velha não grava nada', async () => {
    const { body } = await uploadFile(baseUrl, token, await xlsxBuffer({ Produtos: ROWS }), 'erp.xlsx');
    await http(baseUrl, 'POST', `/api/imports/${body.job.id}/simulate`, token, { mapping: MAPPING, updateFields: ['name'] });
    const message = queue.calls[queue.calls.length - 1].data;
    const cancelled = await http(baseUrl, 'POST', `/api/imports/${body.job.id}/cancel`, token);
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.job.status).toBe('cancelled');

    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(message);
    expect((await job(body.job.id)).status).toBe('cancelled');
    const [{ n }] = await adminQuery(`SELECT count(*)::int AS n FROM import_rows WHERE "jobId" = $1`, [body.job.id]);
    expect(n).toBe(0);
    expect((await simulated()).length).toBeGreaterThan(0);
  });

  it('tentar de novo job cujas linhas foram expurgadas ⇒ 409 (nunca arquiva o catálogo por falta de linhas)', async () => {
    const jobId = await simulated();
    await apply(jobId, { archiveMissing: true, confirmArchiveCount: 1 });
    await adminQuery(`UPDATE import_jobs SET status = 'failed', summary = summary || $2::jsonb WHERE id = $1`, [
      jobId,
      JSON.stringify({ rowsPurged: true }),
    ]);
    const { status, body } = await http(baseUrl, 'POST', `/api/imports/${jobId}/retry`, token);
    expect(status).toBe(409);
    expect(body.errorCode).toBe('INVALID_STATE');
  });

  it('gravação presa em applying há mais de 5 minutos pode ser tentada de novo; recém-iniciada não', async () => {
    const jobId = await simulated();
    await apply(jobId);
    expect((await http(baseUrl, 'POST', `/api/imports/${jobId}/retry`, token)).status).toBe(409);

    const before = (await job(jobId)).options.applyRunId;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await adminQuery(`UPDATE import_jobs SET options = options || $2::jsonb WHERE id = $1`, [
      jobId,
      JSON.stringify({ applyRequestedAt: tenMinutesAgo }),
    ]);
    queue.calls.length = 0;
    const { status } = await http(baseUrl, 'POST', `/api/imports/${jobId}/retry`, token);
    expect(status).toBe(202);
    expect((await job(jobId)).options.applyRunId).not.toBe(before);
    expect(queue.calls).toHaveLength(1);
  });

  it('pedido vencido de outra importação não bloqueia: a importação que esperava é cancelada', async () => {
    await seedUser(companyId);
    await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } });
    const stuck = await simulated();
    const { body } = await apply(stuck, { justification: 'x' });
    await adminQuery(`UPDATE change_requests SET "expiresAt" = now() - interval '1 day' WHERE id = $1`, [body.changeRequestId]);
    await setPolicies(companyId, {});

    const next = await simulated();
    expect((await apply(next)).status).toBe(202);
    expect((await job(stuck)).status).toBe('cancelled');
  });

  describe('política de preço contra o preço ATUAL (não o da simulação)', () => {
    beforeEach(() => setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 20 } }));

    it('preço editado depois da simulação torna a mudança sensível', async () => {
      const jobId = await simulated([['EAN', 'Descrição', 'Preço'], ['100', 'Arroz', '10,50']]);
      await adminQuery(`UPDATE products SET "unitPrice" = 5 WHERE barcode = '100'`);
      expect((await apply(jobId)).body.errorCode).toBe('JUSTIFICATION_REQUIRED');
    });

    it('preço editado depois da simulação pode deixar de ser sensível', async () => {
      const jobId = await simulated([['EAN', 'Descrição', 'Preço'], ['100', 'Arroz', '15,00']]);
      await adminQuery(`UPDATE products SET "unitPrice" = 15 WHERE barcode = '100'`);
      expect((await apply(jobId)).status).toBe(202);
    });
  });

  it('depois que a gravação começou, simular ou trocar de aba ⇒ 409', async () => {
    const jobId = await simulated();
    await apply(jobId);
    await adminQuery(`UPDATE import_jobs SET status = 'failed' WHERE id = $1`, [jobId]);
    expect((await http(baseUrl, 'POST', `/api/imports/${jobId}/simulate`, token, { mapping: MAPPING, updateFields: [] })).status).toBe(409);
    expect((await http(baseUrl, 'POST', `/api/imports/${jobId}/preview`, token, { sheetName: 'Produtos' })).status).toBe(409);
  });
});

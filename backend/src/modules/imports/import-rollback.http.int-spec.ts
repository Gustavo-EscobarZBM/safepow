jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedLoss, seedUser, setPolicies, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { UserRole } from '../users/user.entity';
import { xlsxBuffer } from './engine/test-fixtures';
import { ImportApplier } from './import-applier';
import { ImportRollbacker } from './import-rollbacker';
import { ImportSimulator } from './import-simulator';

const MAPPING = { barcode: 'EAN', name: 'Descrição', unitPrice: 'Preço' };

describe('Reversão da importação (SP3, 3.4)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let queue: FakeQueue;
  let companyId: string;
  let managerId: string;
  let token: string;
  let ids: Record<string, string>;

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
    companyId = await seedCompany('Empresa Reversão');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
    ids = {
      arroz: await seedProduct({ companyId, barcode: '100', name: 'Arroz', unitPrice: 10 }),
      feijao: await seedProduct({ companyId, barcode: '200', name: 'Feijão', unitPrice: 7 }),
      sal: await seedProduct({ companyId, barcode: '400', name: 'Sal', unitPrice: 2 }),
    };
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [ids.feijao]);
  });

  /** Importação concluída: 1 criado (1234567), 1 atualizado (Arroz), 1 reativado (Feijão), 1 arquivado (Sal). */
  async function imported(): Promise<string> {
    const rows = [
      ['EAN', 'Descrição', 'Preço'],
      ['1234567', 'Novo', '3,00'],
      ['100', 'Arroz Tipo 1', '12,00'],
      ['200', 'Feijão Carioca', '8,00'],
    ];
    const { body } = await uploadFile(baseUrl, token, await xlsxBuffer({ Produtos: rows }), 'erp.xlsx');
    await http(baseUrl, 'POST', `/api/imports/${body.job.id}/simulate`, token, { mapping: MAPPING, updateFields: ['name', 'unitPrice'] });
    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(queue.calls.pop()!.data);
    const apply = await http(baseUrl, 'POST', `/api/imports/${body.job.id}/apply`, token, { archiveMissing: true, confirmArchiveCount: 1 });
    expect(apply.status).toBe(202);
    await new ImportApplier(await appDataSource()).run(queue.calls.pop()!.data);
    const [job] = await adminQuery(`SELECT status FROM import_jobs WHERE id = $1`, [body.job.id]);
    expect(job.status).toBe('completed');
    return body.job.id;
  }

  const preview = (jobId: string, query = '', asToken = token) =>
    http(baseUrl, 'GET', `/api/imports/${jobId}/rollback-preview${query}`, asToken);

  describe('prévia', () => {
    it('sem mudanças depois: tudo volta, nenhum conflito, com a data limite', async () => {
      const jobId = await imported();
      const { status, body } = await preview(jobId);
      expect(status).toBe(200);
      expect(body).toMatchObject({ restore: 4, conflicts: 0, items: [], total: 0 });
      const [{ appliedAt }] = await adminQuery(`SELECT "appliedAt" FROM import_jobs WHERE id = $1`, [jobId]);
      expect(new Date(body.expiresAt).getTime() - new Date(appliedAt).getTime()).toBe(30 * 24 * 3600 * 1000);
    });

    it('produto editado depois da importação vira conflito', async () => {
      const jobId = await imported();
      await adminQuery(`UPDATE products SET "unitPrice" = 15, "updatedAt" = clock_timestamp() WHERE id = $1`, [ids.arroz]);
      const { body } = await preview(jobId);
      expect(body).toMatchObject({
        restore: 3,
        conflicts: 1,
        total: 1,
        items: [{ key: '100', name: 'Arroz Tipo 1', appliedAction: 'update', reason: 'changed' }],
      });
    });

    it('conflitos paginados', async () => {
      const jobId = await imported();
      await adminQuery(`UPDATE products SET "updatedAt" = clock_timestamp() WHERE id = ANY($1)`, [[ids.arroz, ids.sal]]);
      const { body } = await preview(jobId, '?page=1&limit=1');
      expect(body.conflicts).toBe(2);
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(1);
    });

    it('job que não está concluído ⇒ 409 INVALID_STATE', async () => {
      const { body } = await uploadFile(baseUrl, token, await xlsxBuffer({ Produtos: [['EAN', 'Descrição'], ['1', 'A']] }), 'a.xlsx');
      const result = await preview(body.job.id);
      expect(result.status).toBe(409);
      expect(result.body.errorCode).toBe('INVALID_STATE');
    });

    it('mais de 30 dias ou linhas expurgadas ⇒ 409 ROLLBACK_EXPIRED', async () => {
      const jobId = await imported();
      await adminQuery(`UPDATE import_jobs SET "appliedAt" = now() - interval '31 days' WHERE id = $1`, [jobId]);
      expect((await preview(jobId)).body.errorCode).toBe('ROLLBACK_EXPIRED');

      await adminQuery(
        `UPDATE import_jobs SET "appliedAt" = now(), summary = summary || '{"rowsPurged": true}'::jsonb WHERE id = $1`,
        [jobId],
      );
      const purged = await preview(jobId);
      expect(purged.status).toBe(409);
      expect(purged.body.errorCode).toBe('ROLLBACK_EXPIRED');
    });

    it('funcionário ⇒ 403', async () => {
      const jobId = await imported();
      const employee = await seedUser(companyId, 'employee');
      expect((await preview(jobId, '', await tokenFor(employee, companyId, UserRole.EMPLOYEE))).status).toBe(403);
    });
  });

  describe('reverter', () => {
    const rollback = (jobId: string, body: Record<string, unknown> = {}, asToken = token) =>
      http(baseUrl, 'POST', `/api/imports/${jobId}/rollback`, asToken, body);
    const product = async (id: string) =>
      (await adminQuery(`SELECT name, "unitPrice", "isActive" FROM products WHERE id = $1`, [id]))[0];
    const job = async (id: string) => (await adminQuery(`SELECT * FROM import_jobs WHERE id = $1`, [id]))[0];
    const runRollback = async (limits = {}) =>
      new ImportRollbacker(await appDataSource(), limits).run(queue.calls.pop()!.data);

    it('desfaz tudo: criado arquivado, atualizado e reativado com os valores antigos, ausente reativado', async () => {
      const jobId = await imported();
      const created = (await adminQuery(`SELECT id FROM products WHERE barcode = '1234567'`))[0].id;
      const { status, body } = await rollback(jobId);
      expect(status).toBe(202);
      expect(body.job.status).toBe('rolling_back');
      expect(queue.calls).toEqual([expect.objectContaining({ name: 'rollback', data: expect.objectContaining({ jobId, companyId }) })]);

      await runRollback();
      expect(await product(created)).toMatchObject({ isActive: false });
      expect(await product(ids.arroz)).toEqual({ name: 'Arroz', unitPrice: '10.00', isActive: true });
      expect(await product(ids.feijao)).toEqual({ name: 'Feijão', unitPrice: '7.00', isActive: false });
      expect(await product(ids.sal)).toMatchObject({ isActive: true });

      const done = await job(jobId);
      expect(done.status).toBe('rolled_back');
      expect(done.rolledBackAt).not.toBeNull();
      expect(done.summary).toMatchObject({ rolledBackCount: 4, conflictCount: 0 });
      const results = await adminQuery(
        `SELECT "rollbackResult", count(*)::int AS n FROM import_rows WHERE "jobId" = $1 AND "rolledBackAt" IS NOT NULL GROUP BY 1`,
        [jobId],
      );
      expect(results).toEqual([{ rollbackResult: 'restored', n: 4 }]);
      const [history] = await adminQuery(
        `SELECT source, "unitPrice" FROM product_price_history WHERE "productId" = $1 ORDER BY seq DESC LIMIT 1`,
        [ids.arroz],
      );
      expect(history).toEqual({ source: 'import_rollback', unitPrice: '10.00' });
      expect(
        await adminQuery(`SELECT 1 FROM audit_log WHERE "entityType" = 'import_job' AND "entityId" = $1 AND action = 'rollback'`, [jobId]),
      ).toHaveLength(1);
    });

    it('produto editado entre o pedido e o worker fica como está (conflito reconferido no momento)', async () => {
      const jobId = await imported();
      await rollback(jobId);
      await adminQuery(`UPDATE products SET "unitPrice" = 20, "updatedAt" = clock_timestamp() WHERE id = $1`, [ids.arroz]);
      await runRollback();
      expect((await product(ids.arroz)).unitPrice).toBe('20.00');
      expect((await job(jobId)).summary).toMatchObject({ rolledBackCount: 3, conflictCount: 1 });
      const [row] = await adminQuery(`SELECT "rollbackResult" FROM import_rows WHERE "jobId" = $1 AND key = '100'`, [jobId]);
      expect(row.rollbackResult).toBe('conflict');
    });

    it('falha no meio: volta a concluída com a mensagem; reverter de novo termina sem desfazer duas vezes', async () => {
      const jobId = await imported();
      await rollback(jobId);
      let batches = 0;
      await runRollback({
        batchSize: 1,
        beforeBatch: async () => {
          batches += 1;
          if (batches === 3) throw new Error('banco caiu');
        },
      });
      const failed = await job(jobId);
      expect(failed.status).toBe('completed');
      expect(failed.lastError).toBe('banco caiu');
      const [{ n: halfway }] = await adminQuery(
        `SELECT count(*)::int AS n FROM import_rows WHERE "jobId" = $1 AND "rolledBackAt" IS NOT NULL`,
        [jobId],
      );
      expect(halfway).toBe(2);

      expect((await rollback(jobId)).status).toBe(202);
      await runRollback();
      const done = await job(jobId);
      expect(done.status).toBe('rolled_back');
      expect(done.lastError).toBeNull();
      expect(done.summary).toMatchObject({ rolledBackCount: 4, conflictCount: 0 });
    });

    it('já revertendo ⇒ 409 INVALID_STATE; outra importação em andamento ⇒ 409 IMPORT_IN_PROGRESS', async () => {
      const jobId = await imported();
      await rollback(jobId);
      const again = await rollback(jobId);
      expect(again.status).toBe(409);
      expect(again.body.errorCode).toBe('INVALID_STATE');

      await adminQuery(`UPDATE import_jobs SET status = 'completed' WHERE id = $1`, [jobId]);
      await adminQuery(
        `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status) VALUES ($1, 'outra.xlsx', 'k', 'applying')`,
        [companyId],
      );
      const busy = await rollback(jobId);
      expect(busy.status).toBe(409);
      expect(busy.body.errorCode).toBe('IMPORT_IN_PROGRESS');
    });

    it('preço voltando além do limite com 1 gerente ⇒ pede justificativa; com ela, reverte', async () => {
      const jobId = await imported();
      await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } });
      const first = await rollback(jobId);
      expect(first.status).toBe(409);
      expect(first.body.errorCode).toBe('JUSTIFICATION_REQUIRED');
      const second = await rollback(jobId, { justification: 'Planilha errada' });
      expect(second.status).toBe(202);
      expect(second.body.job.status).toBe('rolling_back');
    });

    it('arquivar criado que já tem perda com política de histórico ⇒ pede justificativa', async () => {
      const jobId = await imported();
      const created = (await adminQuery(`SELECT id FROM products WHERE barcode = '1234567'`))[0].id;
      await seedLoss(companyId, created, managerId);
      await adminQuery(`UPDATE products SET "updatedAt" = (SELECT "appliedUpdatedAt" FROM import_rows WHERE "jobId" = $1 AND key = '1234567') WHERE id = $2`, [jobId, created]);
      await setPolicies(companyId, { archive_with_history: { enabled: true } });
      const result = await rollback(jobId);
      expect(result.status).toBe(409);
      expect(result.body.errorCode).toBe('JUSTIFICATION_REQUIRED');
    });

    it('mensagem velha (outra reversão começou depois) não reverte nada', async () => {
      const jobId = await imported();
      await rollback(jobId);
      const stale = queue.calls.pop()!.data;
      await adminQuery(`UPDATE import_jobs SET options = options || '{"rollbackRunId": "outro"}'::jsonb WHERE id = $1`, [jobId]);
      await new ImportRollbacker(await appDataSource()).run(stale);
      expect(await product(ids.arroz)).toMatchObject({ name: 'Arroz Tipo 1' });
    });
  });
});

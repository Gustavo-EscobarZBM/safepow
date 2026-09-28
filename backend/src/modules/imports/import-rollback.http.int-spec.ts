jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { UserRole } from '../users/user.entity';
import { xlsxBuffer } from './engine/test-fixtures';
import { ImportApplier } from './import-applier';
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
});

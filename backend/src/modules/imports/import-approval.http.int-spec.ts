jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedUser, setPolicies, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { ApprovalsController } from '../approvals/approvals.controller';
import { ApprovalsService } from '../approvals/approvals.service';
import { LossesService } from '../losses/losses.service';
import { ProductsService } from '../products/products.service';
import { StorageService } from '../uploads/storage.service';
import { xlsxBuffer } from './engine/test-fixtures';
import { ImportApplier } from './import-applier';
import { ImportRollbacker } from './import-rollbacker';
import { ImportSimulator } from './import-simulator';

const MAPPING = { barcode: 'EAN', name: 'Descrição', unitPrice: 'Preço' };

describe('Pedido de aprovação de importação (SP3, 3.1.2)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let queue: FakeQueue;
  let companyId: string;
  let requesterToken: string;
  let approverToken: string;

  beforeAll(async () => {
    ({ app, baseUrl, storage, queue } = await startImportsApp({
      controllers: [ApprovalsController],
      providers: [ApprovalsService, ProductsService, LossesService],
    }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    queue.calls.length = 0;
    companyId = await seedCompany('Empresa Aprovação de Importação');
    const requester = await seedUser(companyId);
    const approver = await seedUser(companyId);
    requesterToken = await tokenFor(requester, companyId);
    approverToken = await tokenFor(approver, companyId);
    await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } });
    await seedProduct({ companyId, barcode: '100', name: 'Arroz', unitPrice: 10 });
  });

  /** Importação simulada e enviada para aprovação (10 → 15 passa do limite de 10%). */
  async function pendingImport(): Promise<{ jobId: string; requestId: string }> {
    const { body } = await uploadFile(
      baseUrl,
      requesterToken,
      await xlsxBuffer({ Produtos: [['EAN', 'Descrição', 'Preço'], ['100', 'Arroz', '15,00']] }),
      'erp.xlsx',
    );
    const jobId = body.job.id;
    await http(baseUrl, 'POST', `/api/imports/${jobId}/simulate`, requesterToken, { mapping: MAPPING, updateFields: ['unitPrice'] });
    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(queue.calls[0].data);
    const applied = await http(baseUrl, 'POST', `/api/imports/${jobId}/apply`, requesterToken, { justification: 'Tabela nova' });
    expect(applied.body.status).toBe('pending');
    queue.calls.length = 0;
    return { jobId, requestId: applied.body.changeRequestId };
  }

  const jobStatus = async (jobId: string) => (await adminQuery(`SELECT status FROM import_jobs WHERE id = $1`, [jobId]))[0].status;
  const requestStatus = async (id: string) => (await adminQuery(`SELECT status FROM change_requests WHERE id = $1`, [id]))[0].status;

  it('outro gerente aprova: job applying, gravação enfileirada e concluída', async () => {
    const { jobId, requestId } = await pendingImport();
    const { status } = await http(baseUrl, 'POST', `/api/change-requests/${requestId}/approve`, approverToken, {});
    expect(status).toBe(200);
    expect(await requestStatus(requestId)).toBe('approved');
    expect(await jobStatus(jobId)).toBe('applying');
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0].name).toBe('apply');

    await new ImportApplier(await appDataSource()).run(queue.calls[0].data);
    expect(await jobStatus(jobId)).toBe('completed');
    expect((await adminQuery(`SELECT "unitPrice" FROM products WHERE barcode = '100'`))[0].unitPrice).toBe('15.00');
  });

  it('quem pediu não aprova', async () => {
    const { requestId } = await pendingImport();
    const { status, body } = await http(baseUrl, 'POST', `/api/change-requests/${requestId}/approve`, requesterToken, {});
    expect(status).toBe(403);
    expect(body.errorCode).toBe('SELF_APPROVAL');
  });

  it('job mudou depois do pedido ⇒ aprovar expira o pedido e não grava', async () => {
    const { jobId, requestId } = await pendingImport();
    await adminQuery(`UPDATE import_jobs SET "simulatedAt" = now() + interval '1 minute' WHERE id = $1`, [jobId]);
    await http(baseUrl, 'POST', `/api/change-requests/${requestId}/approve`, approverToken, {});
    expect(await requestStatus(requestId)).toBe('expired');
    expect(queue.calls).toHaveLength(0);
    expect(await jobStatus(jobId)).toBe('cancelled');
  });

  it('recusar ⇒ job cancelado', async () => {
    const { jobId, requestId } = await pendingImport();
    await http(baseUrl, 'POST', `/api/change-requests/${requestId}/reject`, approverToken, { note: 'Não' });
    expect(await requestStatus(requestId)).toBe('rejected');
    expect(await jobStatus(jobId)).toBe('cancelled');
  });

  it('quem pediu cancela o pedido ⇒ job cancelado', async () => {
    const { jobId, requestId } = await pendingImport();
    await http(baseUrl, 'POST', `/api/change-requests/${requestId}/cancel`, requesterToken, {});
    expect(await requestStatus(requestId)).toBe('cancelled');
    expect(await jobStatus(jobId)).toBe('cancelled');
  });

  it('pedido vencido ⇒ ao consultar a importação, ela aparece cancelada e o pedido expirado', async () => {
    const { jobId, requestId } = await pendingImport();
    await adminQuery(`UPDATE change_requests SET "expiresAt" = now() - interval '1 day' WHERE id = $1`, [requestId]);
    const { body } = await http(baseUrl, 'GET', `/api/imports/${jobId}`, requesterToken);
    expect(body.status).toBe('cancelled');
    expect(body.lastError).toBe('Pedido de aprovação recusado, cancelado ou vencido.');
    expect(await requestStatus(requestId)).toBe('expired');
  });

  describe('reversão com aprovação (SP3, 3.4)', () => {
    /** Importação aprovada e gravada (Arroz 10 → 15); a reversão (15 → 10) passa do limite de 10%. */
    async function completedImport(): Promise<string> {
      const { jobId, requestId } = await pendingImport();
      await http(baseUrl, 'POST', `/api/change-requests/${requestId}/approve`, approverToken, {});
      await new ImportApplier(await appDataSource()).run(queue.calls.pop()!.data);
      expect(await jobStatus(jobId)).toBe('completed');
      return jobId;
    }

    async function pendingRollback(jobId: string): Promise<string> {
      const { status, body } = await http(baseUrl, 'POST', `/api/imports/${jobId}/rollback`, requesterToken, {
        justification: 'Planilha errada',
      });
      expect(status).toBe(202);
      expect(body.status).toBe('pending');
      expect(body.job.status).toBe('completed');
      expect(queue.calls).toHaveLength(0);
      const [job] = await adminQuery(`SELECT options FROM import_jobs WHERE id = $1`, [jobId]);
      expect(job.options.rollbackRequestId).toBe(body.changeRequestId);
      return body.changeRequestId;
    }

    it('outro gerente aprova: reversão começa e desfaz o preço', async () => {
      const jobId = await completedImport();
      const requestId = await pendingRollback(jobId);
      const approved = await http(baseUrl, 'POST', `/api/change-requests/${requestId}/approve`, approverToken, {});
      expect(approved.status).toBe(200);
      expect(await requestStatus(requestId)).toBe('approved');
      expect(await jobStatus(jobId)).toBe('rolling_back');
      expect(queue.calls.map((c) => c.name)).toEqual(['rollback']);
      await new ImportRollbacker(await appDataSource()).run(queue.calls.pop()!.data);
      expect(await jobStatus(jobId)).toBe('rolled_back');
      expect((await adminQuery(`SELECT "unitPrice" FROM products WHERE barcode = '100'`))[0].unitPrice).toBe('10.00');
    });

    it('recusar: a importação continua concluída e pode ser revertida de novo', async () => {
      const jobId = await completedImport();
      const requestId = await pendingRollback(jobId);
      await http(baseUrl, 'POST', `/api/change-requests/${requestId}/reject`, approverToken, { note: 'Não' });
      expect(await jobStatus(jobId)).toBe('completed');
      const [job] = await adminQuery(`SELECT options FROM import_jobs WHERE id = $1`, [jobId]);
      expect(job.options.rollbackRequestId).toBeUndefined();
      expect((await http(baseUrl, 'GET', `/api/imports/${jobId}/rollback-preview`, requesterToken)).status).toBe(200);
    });
  });
});

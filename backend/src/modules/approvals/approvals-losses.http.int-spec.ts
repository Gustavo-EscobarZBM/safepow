import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, setPolicies, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';

const JUSTIFICATION = 'Quantidade lançada errada no app';

describe('Aprovações — Perdas (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerId: string;
  let token: string;
  let lossId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Perdas');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
    const productId = await seedProduct({ companyId, barcode: '1', name: 'Óleo', unitPrice: 8 });
    lossId = await seedLoss(companyId, productId, managerId);
  });

  const quantityOf = async () => (await adminQuery(`SELECT quantity FROM losses WHERE id = $1`, [lossId]))[0]?.quantity;

  it('política desligada: editar e excluir como antes', async () => {
    expect((await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3 })).status).toBe(200);
    expect((await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token)).status).toBe(204);
  });

  describe('loss_edit ligada, 1 gerente', () => {
    beforeEach(() => setPolicies(companyId, { loss_edit: { enabled: true } }));

    it('editar sem justificativa ⇒ 409; com ⇒ 200 e auditoria com o motivo', async () => {
      expect((await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3 })).status).toBe(409);
      expect(Number(await quantityOf())).toBe(2);

      const { status } = await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3, justification: JUSTIFICATION });
      expect(status).toBe(200);
      expect(Number(await quantityOf())).toBe(3);
      const [row] = await adminQuery(`SELECT reason FROM audit_log WHERE "entityId" = $1 AND action = 'update'`, [lossId]);
      expect(row.reason).toBe(JUSTIFICATION);
    });

    it('excluir sem justificativa ⇒ 409; com ⇒ 204', async () => {
      expect((await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token)).status).toBe(409);
      expect((await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token, { justification: JUSTIFICATION })).status).toBe(204);
      expect(await quantityOf()).toBeUndefined();
    });
  });

  describe('loss_edit ligada, 2 gerentes', () => {
    beforeEach(async () => {
      await seedUser(companyId);
      await setPolicies(companyId, { loss_edit: { enabled: true } });
    });

    it('editar ⇒ 202 e a perda fica como estava', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3, justification: JUSTIFICATION });
      expect(status).toBe(202);
      expect(body.policy).toBe('loss_edit');
      expect(Number(await quantityOf())).toBe(2);
      const [request] = await adminQuery(`SELECT operation, "entityLabel", payload FROM change_requests`);
      expect(request).toEqual({ operation: 'update', entityLabel: 'Perda de Óleo', payload: { quantity: 3 } });
    });

    it('excluir ⇒ 202 e a perda continua existindo', async () => {
      const { status } = await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token, { justification: JUSTIFICATION });
      expect(status).toBe(202);
      expect(Number(await quantityOf())).toBe(2);
    });
  });
});

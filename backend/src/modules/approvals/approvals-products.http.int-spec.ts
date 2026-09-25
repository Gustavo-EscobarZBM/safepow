import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, setPolicies, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';

const JUSTIFICATION = 'Fornecedor reajustou a tabela';

describe('Aprovações — Produtos (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerId: string;
  let token: string;
  let productId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Aprovações');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
    productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz', unitPrice: 10, costPrice: 6 });
  });

  const priceOf = async () => (await adminQuery(`SELECT "unitPrice" FROM products WHERE id = $1`, [productId]))[0].unitPrice;

  it('política desligada: mudança grande passa sem justificativa', async () => {
    const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 50 });
    expect(status).toBe(200);
    expect(await priceOf()).toBe('50.00');
  });

  describe('com price_change ligada e 1 gerente (modo justificativa)', () => {
    beforeEach(() => setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 20 } }));

    it('sem justificativa ⇒ 409 JUSTIFICATION_REQUIRED e nada muda', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15 });
      expect(status).toBe(409);
      expect(body).toMatchObject({ errorCode: 'JUSTIFICATION_REQUIRED', policy: 'price_change', mode: 'justification' });
      expect(await priceOf()).toBe('10.00');
    });

    it('com justificativa ⇒ 200, grava e a auditoria leva o motivo (+ evento justify)', async () => {
      const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });
      expect(status).toBe(200);
      expect(await priceOf()).toBe('15.00');
      const rows = await adminQuery(
        `SELECT action, reason FROM audit_log WHERE "entityId" = $1 AND action IN ('update','justify') ORDER BY seq`,
        [productId],
      );
      expect(rows).toEqual([
        { action: 'justify', reason: JUSTIFICATION },
        { action: 'update', reason: JUSTIFICATION },
      ]);
    });

    it('variação dentro do limite e preço anterior zero não pedem nada', async () => {
      expect((await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 12 })).status).toBe(200);
      const zeroId = await seedProduct({ companyId, barcode: '2', name: 'Novo', unitPrice: 0 });
      expect((await http(baseUrl, 'PATCH', `/api/products/${zeroId}`, token, { unitPrice: 99 })).status).toBe(200);
    });

    it('justificativa curta ou só espaços ⇒ 400', async () => {
      for (const justification of ['curta', '          ']) {
        const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification });
        expect(status).toBe(400);
      }
      expect(await priceOf()).toBe('10.00');
    });
  });

  describe('com 2 gerentes ativos (modo aprovação)', () => {
    beforeEach(async () => {
      await seedUser(companyId);
      await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 20 }, archive_with_history: { enabled: true } });
    });

    it('sem justificativa ⇒ 409 com mode approval', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15 });
      expect(status).toBe(409);
      expect(body.mode).toBe('approval');
    });

    it('com justificativa ⇒ 202 pendente, produto intacto, pedido e evento "request" gravados', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });

      expect(status).toBe(202);
      expect(body).toMatchObject({ status: 'pending', policy: 'price_change' });
      expect(await priceOf()).toBe('10.00');
      const [request] = await adminQuery(`SELECT * FROM change_requests WHERE id = $1`, [body.changeRequestId]);
      expect(request).toMatchObject({
        status: 'pending',
        entityType: 'product',
        entityId: productId,
        entityLabel: 'Arroz',
        operation: 'update',
        payload: { unitPrice: 15 },
        justification: JUSTIFICATION,
        requestedByUserId: managerId,
      });
      expect(request.snapshot).toMatchObject({ unitPrice: '10.00', name: 'Arroz' });
      const [event] = await adminQuery(`SELECT action, reason FROM audit_log WHERE "entityId" = $1`, [body.changeRequestId]);
      expect(event).toEqual({ action: 'request', reason: JUSTIFICATION });
    });

    it('um gerente inativo não conta: 1 ativo + 1 inativo ⇒ modo justificativa', async () => {
      await adminQuery(`UPDATE users SET "isActive" = false WHERE id <> $1 AND "companyId" = $2`, [managerId, companyId]);
      const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });
      expect(status).toBe(200);
    });

    it('pedir de novo cancela o pedido pendente anterior', async () => {
      const first = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });
      const second = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 16, justification: JUSTIFICATION });

      const rows = await adminQuery(`SELECT id, status FROM change_requests ORDER BY "createdAt"`);
      expect(rows).toEqual([
        { id: first.body.changeRequestId, status: 'cancelled' },
        { id: second.body.changeRequestId, status: 'pending' },
      ]);
    });

    it('arquivar produto COM perdas ⇒ 409, depois 202 e o produto segue ativo; SEM perdas ⇒ 204', async () => {
      await seedLoss(companyId, productId, managerId);
      expect((await http(baseUrl, 'DELETE', `/api/products/${productId}`, token)).status).toBe(409);
      const pending = await http(baseUrl, 'DELETE', `/api/products/${productId}`, token, { justification: JUSTIFICATION });
      expect(pending.status).toBe(202);
      expect(pending.body.policy).toBe('archive_with_history');
      expect((await adminQuery(`SELECT "isActive" FROM products WHERE id = $1`, [productId]))[0].isActive).toBe(true);

      const cleanId = await seedProduct({ companyId, barcode: '3', name: 'Sem perdas' });
      expect((await http(baseUrl, 'DELETE', `/api/products/${cleanId}`, token)).status).toBe(204);
    });
  });
});

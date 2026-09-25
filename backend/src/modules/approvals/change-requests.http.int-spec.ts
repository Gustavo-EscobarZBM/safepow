import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, setPolicies, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

const JUSTIFICATION = 'Fornecedor reajustou a tabela';

describe('Fila de pedidos de aprovação (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let requesterId: string;
  let approverId: string;
  let requesterToken: string;
  let approverToken: string;
  let productId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp({ controllers: [ApprovalsController], providers: [ApprovalsService] }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Fila');
    requesterId = await seedUser(companyId, 'manager', { name: 'Ana' });
    approverId = await seedUser(companyId, 'manager', { name: 'Bruno' });
    requesterToken = await tokenFor(requesterId, companyId);
    approverToken = await tokenFor(approverId, companyId);
    productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz', unitPrice: 10, costPrice: 6 });
    await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 20 }, loss_edit: { enabled: true } });
  });

  async function requestPriceChange(unitPrice = 15): Promise<string> {
    const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, requesterToken, { unitPrice, justification: JUSTIFICATION });
    expect(status).toBe(202);
    return body.changeRequestId;
  }
  const productPrice = async () => (await adminQuery(`SELECT "unitPrice" FROM products WHERE id = $1`, [productId]))[0].unitPrice;
  const statusOf = async (id: string) => (await adminQuery(`SELECT status FROM change_requests WHERE id = $1`, [id]))[0].status;

  it('lista pendentes com quem pediu, e conta os pendentes', async () => {
    const id = await requestPriceChange();

    const { status, body } = await http(baseUrl, 'GET', '/api/change-requests?status=pending', approverToken);
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id, requestedByName: 'Ana', entityLabel: 'Arroz', payload: { unitPrice: 15 }, status: 'pending' });
    expect((await http(baseUrl, 'GET', '/api/change-requests/pending-count', approverToken)).body).toEqual({ count: 1 });
  });

  it('outro gerente aprova ⇒ aplica pelo mesmo serviço, histórico de preço "approval", auditoria com o motivo', async () => {
    const id = await requestPriceChange();

    const { status, body } = await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, { note: 'Ok, conferi a nota' });

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'approved', decidedByName: 'Bruno', decisionNote: 'Ok, conferi a nota' });
    expect(await productPrice()).toBe('15.00');
    const [history] = await adminQuery(
      `SELECT source FROM product_price_history WHERE "productId" = $1 ORDER BY seq DESC LIMIT 1`,
      [productId],
    );
    expect(history.source).toBe('approval');
    const [update] = await adminQuery(
      `SELECT "actorUserId", reason FROM audit_log WHERE "entityId" = $1 AND action = 'update'`,
      [productId],
    );
    expect(update).toEqual({ actorUserId: approverId, reason: JUSTIFICATION });
    const [approve] = await adminQuery(`SELECT reason FROM audit_log WHERE "entityId" = $1 AND action = 'approve'`, [id]);
    expect(approve.reason).toBe('Ok, conferi a nota');
  });

  it('quem pediu não aprova nem recusa (403); pode cancelar', async () => {
    const id = await requestPriceChange();

    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, requesterToken, {})).body.errorCode).toBe('SELF_APPROVAL');
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/reject`, requesterToken, {})).status).toBe(403);
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/cancel`, approverToken, {})).status).toBe(403);

    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/cancel`, requesterToken, {})).status).toBe(200);
    expect(await statusOf(id)).toBe('cancelled');
    expect(await productPrice()).toBe('10.00');
  });

  it('recusar ⇒ nada muda, status rejected e evento "reject" com a nota', async () => {
    const id = await requestPriceChange();

    const { status } = await http(baseUrl, 'POST', `/api/change-requests/${id}/reject`, approverToken, { note: 'Preço fora da tabela' });

    expect(status).toBe(200);
    expect(await statusOf(id)).toBe('rejected');
    expect(await productPrice()).toBe('10.00');
    const [event] = await adminQuery(`SELECT reason FROM audit_log WHERE "entityId" = $1 AND action = 'reject'`, [id]);
    expect(event.reason).toBe('Preço fora da tabela');
  });

  it('pedido decidido não pode ser decidido de novo (409 REQUEST_NOT_PENDING)', async () => {
    const id = await requestPriceChange();
    await http(baseUrl, 'POST', `/api/change-requests/${id}/reject`, approverToken, {});
    const { status, body } = await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, {});
    expect(status).toBe(409);
    expect(body.errorCode).toBe('REQUEST_NOT_PENDING');
  });

  it('expiração preguiçosa: vencido vira expired ao listar e não pode ser aprovado', async () => {
    const id = await requestPriceChange();
    await adminQuery(`UPDATE change_requests SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [id]);

    expect((await http(baseUrl, 'GET', '/api/change-requests?status=pending', approverToken)).body).toEqual([]);
    expect(await statusOf(id)).toBe('expired');
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, {})).status).toBe(409);
    const decided = (await http(baseUrl, 'GET', '/api/change-requests?status=decided', approverToken)).body;
    expect(decided[0]).toMatchObject({ id, status: 'expired' });
  });

  it('registro mudou desde o pedido ⇒ não aplica, fica expired com a nota (e a marcação persiste)', async () => {
    const id = await requestPriceChange();
    await adminQuery(`UPDATE products SET name = 'Arroz tipo 1' WHERE id = $1`, [productId]);

    const { status, body } = await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, {});

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'expired', decisionNote: 'O registro mudou desde o pedido.' });
    expect(await productPrice()).toBe('10.00');
    expect(await statusOf(id)).toBe('expired');
  });

  it('reaplicação que falha (código de barras passou a conflitar) ⇒ erro e o pedido continua pendente', async () => {
    const { body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, requesterToken, {
      barcode: '999',
      unitPrice: 15,
      justification: JUSTIFICATION,
    });
    await seedProduct({ companyId, barcode: '999', name: 'Outro' });

    const { status } = await http(baseUrl, 'POST', `/api/change-requests/${body.changeRequestId}/approve`, approverToken, {});

    expect(status).toBe(409);
    expect(await statusOf(body.changeRequestId)).toBe('pending');
    expect(await productPrice()).toBe('10.00');
  });

  it('aprovar exclusão de perda apaga a perda', async () => {
    const lossId = await seedLoss(companyId, productId, requesterId);
    const { body } = await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, requesterToken, { justification: JUSTIFICATION });

    expect((await http(baseUrl, 'POST', `/api/change-requests/${body.changeRequestId}/approve`, approverToken, {})).status).toBe(200);
    expect(await adminQuery(`SELECT id FROM losses WHERE id = $1`, [lossId])).toHaveLength(0);
  });

  it('gerente de outra empresa não vê nem decide (404)', async () => {
    const id = await requestPriceChange();
    const otherCompany = await seedCompany('Outra');
    const outsiderToken = await tokenFor(await seedUser(otherCompany), otherCompany);

    expect((await http(baseUrl, 'GET', '/api/change-requests?status=pending', outsiderToken)).body).toEqual([]);
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, outsiderToken, {})).status).toBe(404);
  });

  it('funcionário não acessa a fila (403); status inválido ⇒ 400', async () => {
    const employeeToken = await tokenFor(await seedUser(companyId, 'employee'), companyId, 'employee' as never);
    expect((await http(baseUrl, 'GET', '/api/change-requests', employeeToken)).status).toBe(403);
    expect((await http(baseUrl, 'GET', '/api/change-requests?status=todos', approverToken)).status).toBe(400);
  });
});

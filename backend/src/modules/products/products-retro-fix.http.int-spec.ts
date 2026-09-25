import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, setPolicies, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';
import { UserRole } from '../users/user.entity';

const JUSTIFICATION = 'Preço digitado errado no cadastro';
const WINDOW = 'from=2026-09-01T00:00:00Z&to=2026-09-20T23:59:59Z';

describe('Correção retroativa de preço (SP2, 2.3)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerId: string;
  let token: string;
  let productId: string;
  let insideA: string;
  let insideB: string;
  let before: string;
  let otherProductLoss: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });

  async function lossAt(product: string, occurredAt: string, quantity: number): Promise<string> {
    const id = await seedLoss(companyId, product, managerId);
    await adminQuery(
      `UPDATE losses SET quantity = $2, "occurredAt" = $3, "unitPriceAtLoss" = 1.20, "unitCostAtLoss" = 0.80,
              "valuationSource" = 'snapshot' WHERE id = $1`,
      [id, quantity, occurredAt],
    );
    return id;
  }
  const lossRow = async (id: string) =>
    (await adminQuery(`SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`, [id]))[0];

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Retro');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
    productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz', unitPrice: 12, costPrice: 8 });
    const otherProductId = await seedProduct({ companyId, barcode: '2', name: 'Feijão', unitPrice: 5, costPrice: 3 });
    insideA = await lossAt(productId, '2026-09-05T10:00:00Z', 2);
    insideB = await lossAt(productId, '2026-09-15T10:00:00Z', 3);
    before = await lossAt(productId, '2026-08-31T10:00:00Z', 1);
    otherProductLoss = await lossAt(otherProductId, '2026-09-10T10:00:00Z', 4);
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-20T23:59:59Z',
    unitPrice: 12,
    costPrice: 8,
    justification: JUSTIFICATION,
    ...extra,
  });

  it('prévia mostra o impacto', async () => {
    const { status, body: impact } = await http(
      baseUrl,
      'GET',
      `/api/products/${productId}/retro-fix/preview?${WINDOW}&unitPrice=12&costPrice=8`,
      token,
    );
    expect(status).toBe(200);
    expect(impact).toEqual({ affectedLosses: 2, currentTotal: 6, newTotal: 60, currentCostTotal: 4, newCostTotal: 40 });
  });

  it('aplicar: só perdas do produto na janela, recalculated, um evento de auditoria, histórico de preço intacto', async () => {
    const historyBefore = (await adminQuery(`SELECT count(*)::int AS n FROM product_price_history`))[0].n;
    const auditBefore = (await adminQuery(`SELECT count(*)::int AS n FROM audit_log`))[0].n;

    const { status, body: impact } = await http(baseUrl, 'POST', `/api/products/${productId}/retro-fix`, token, body());

    expect(status).toBe(200);
    expect(impact).toEqual({ affectedLosses: 2, currentTotal: 6, newTotal: 60, currentCostTotal: 4, newCostTotal: 40 });
    for (const id of [insideA, insideB]) {
      expect(await lossRow(id)).toEqual({ unitPriceAtLoss: '12.00', unitCostAtLoss: '8.00', valuationSource: 'recalculated' });
    }
    for (const id of [before, otherProductLoss]) {
      expect(await lossRow(id)).toEqual({ unitPriceAtLoss: '1.20', unitCostAtLoss: '0.80', valuationSource: 'snapshot' });
    }

    const events = await adminQuery(`SELECT action, "entityType", "entityId", reason, summary FROM audit_log ORDER BY seq OFFSET $1`, [
      auditBefore,
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'retro_fix', entityType: 'product', entityId: productId, reason: JUSTIFICATION });
    expect(events[0].summary).toMatchObject({ affectedLosses: 2, currentTotal: 6, newTotal: 60, unitPrice: 12, costPrice: 8 });

    expect((await adminQuery(`SELECT count(*)::int AS n FROM product_price_history`))[0].n).toBe(historyBefore);
    expect((await adminQuery(`SELECT "unitPrice" FROM products WHERE id = $1`, [productId]))[0].unitPrice).toBe('12.00');
  });

  it('o relatório por produto passa a mostrar o valor corrigido', async () => {
    await http(baseUrl, 'POST', `/api/products/${productId}/retro-fix`, token, body({ from: '2026-08-01T00:00:00Z' }));
    const { body: rows } = await http(baseUrl, 'GET', '/api/losses/reports/by-product', token);
    const arroz = rows.find((row: { productName: string }) => row.productName === 'Arroz');
    expect(Number(arroz.totalFinancialLoss)).toBe(72); // 6 unidades × 12
  });

  it('aplicar de novo com os mesmos valores não muda nada nem dá erro', async () => {
    await http(baseUrl, 'POST', `/api/products/${productId}/retro-fix`, token, body());
    const { status, body: impact } = await http(baseUrl, 'POST', `/api/products/${productId}/retro-fix`, token, body());
    expect(status).toBe(200);
    expect(impact).toMatchObject({ affectedLosses: 2, currentTotal: 60, newTotal: 60 });
  });

  it('janela sem perdas: 200 com zero e o evento registrado', async () => {
    const { status, body: impact } = await http(
      baseUrl,
      'POST',
      `/api/products/${productId}/retro-fix`,
      token,
      body({ from: '2026-07-01T00:00:00Z', to: '2026-07-10T00:00:00Z' }),
    );
    expect(status).toBe(200);
    expect(impact.affectedLosses).toBe(0);
    expect(await adminQuery(`SELECT id FROM audit_log WHERE action = 'retro_fix'`)).toHaveLength(1);
  });

  it.each([
    ['sem justificativa', { justification: undefined }],
    ['justificativa curta', { justification: '123456789' }],
    ['from futuro', { from: '2999-01-01T00:00:00Z', to: undefined }],
    ['data não interpretável', { from: '20260924' }],
    ['janela de 400 dias', { from: '2025-08-15T00:00:00Z' }],
    ['preço negativo', { unitPrice: -1 }],
  ])('%s ⇒ 400', async (_label, extra) => {
    const { status } = await http(baseUrl, 'POST', `/api/products/${productId}/retro-fix`, token, body(extra));
    expect(status).toBe(400);
    expect((await lossRow(insideA)).valuationSource).toBe('snapshot');
  });

  it('funcionário ⇒ 403; gerente de outra empresa ⇒ 404', async () => {
    const employeeToken = await tokenFor(await seedUser(companyId, 'employee'), companyId, UserRole.EMPLOYEE);
    expect((await http(baseUrl, 'POST', `/api/products/${productId}/retro-fix`, employeeToken, body())).status).toBe(403);

    const other = await seedCompany('Outra');
    const outsider = await tokenFor(await seedUser(other), other);
    expect(
      (await http(baseUrl, 'GET', `/api/products/${productId}/retro-fix/preview?${WINDOW}&unitPrice=12&costPrice=8`, outsider)).status,
    ).toBe(404);
    expect((await http(baseUrl, 'POST', `/api/products/${productId}/retro-fix`, outsider, body())).status).toBe(404);
  });

  it('política retro_fix com 2 gerentes ⇒ 202 pendente, perdas intactas, "to" resolvido no pedido', async () => {
    await seedUser(companyId);
    await setPolicies(companyId, { retro_fix: { enabled: true } });

    const { status, body: pending } = await http(
      baseUrl,
      'POST',
      `/api/products/${productId}/retro-fix`,
      token,
      body({ to: undefined }),
    );

    expect(status).toBe(202);
    expect(pending).toMatchObject({ status: 'pending', policy: 'retro_fix' });
    expect((await lossRow(insideA)).valuationSource).toBe('snapshot');
    const [request] = await adminQuery(`SELECT operation, payload FROM change_requests WHERE id = $1`, [pending.changeRequestId]);
    expect(request.operation).toBe('retro_fix');
    expect(typeof request.payload.to).toBe('string');
  });
});

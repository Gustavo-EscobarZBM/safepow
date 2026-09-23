import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { Product } from '../products/product.entity';
import { resolveLossValuation } from './losses-valuation';

/** Substitui o histórico do produto por linhas com validFrom controlado (o trigger usa clock_timestamp()). */
async function setHistory(
  companyId: string,
  productId: string,
  rows: { validFrom: string; unitPrice: number; costPrice: number }[],
): Promise<void> {
  await adminQuery(`DELETE FROM product_price_history WHERE "productId" = $1`, [productId]);
  for (const row of rows) {
    await adminQuery(
      `INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", source)
       VALUES ($1, $2, $3, $4, $5, 'manual')`,
      [companyId, productId, row.unitPrice, row.costPrice, row.validFrom],
    );
  }
}

async function resolveAt(companyId: string, productId: string, occurredAt: string) {
  return withTenant({ companyId }, async (manager) => {
    const product = await manager.findOneOrFail(Product, { where: { id: productId } });
    return resolveLossValuation(manager, product, new Date(occurredAt));
  });
}

describe('resolveLossValuation — preço vigente em occurredAt', () => {
  let companyId: string;
  let productId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Valuation');
    productId = await seedProduct({ companyId, barcode: '6001', unitPrice: 99, costPrice: 88 });
    await setHistory(companyId, productId, [
      { validFrom: '2026-01-01T00:00:00Z', unitPrice: 10, costPrice: 5 },
      { validFrom: '2026-02-01T00:00:00Z', unitPrice: 20, costPrice: 12 },
      { validFrom: '2026-03-01T00:00:00Z', unitPrice: 30, costPrice: 18 },
    ]);
  });
  afterAll(() => closeTestConnections());

  it('usa a linha vigente na data (a última com validFrom <= occurredAt)', async () => {
    expect(await resolveAt(companyId, productId, '2026-02-15T12:00:00Z')).toEqual({
      unitPrice: 20,
      unitCost: 12,
      source: 'snapshot',
    });
  });

  it('occurredAt exatamente no validFrom já vale o preço novo', async () => {
    expect((await resolveAt(companyId, productId, '2026-03-01T00:00:00Z')).unitPrice).toBe(30);
  });

  it('occurredAt antes da primeira linha (relógio do aparelho atrasado) usa a MAIS ANTIGA, não o preço atual', async () => {
    expect(await resolveAt(companyId, productId, '2025-12-01T00:00:00Z')).toEqual({
      unitPrice: 10,
      unitCost: 5,
      source: 'snapshot',
    });
  });

  it('desempate por seq: duas linhas com o mesmo validFrom, vale a inserida por último', async () => {
    await adminQuery(
      `INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", source)
       VALUES ($1, $2, 40, 24, '2026-04-01T00:00:00Z', 'import'), ($1, $2, 41, 25, '2026-04-01T00:00:00Z', 'import')`,
      [companyId, productId],
    );
    expect((await resolveAt(companyId, productId, '2026-04-02T00:00:00Z')).unitPrice).toBe(41);
  });

  it('produto sem nenhuma linha de histórico usa o preço atual com fallback_current', async () => {
    await setHistory(companyId, productId, []);
    expect(await resolveAt(companyId, productId, '2026-02-15T12:00:00Z')).toEqual({
      unitPrice: 99,
      unitCost: 88,
      source: 'fallback_current',
    });
  });
});

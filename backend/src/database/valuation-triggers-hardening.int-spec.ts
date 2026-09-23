import { randomUUID } from 'crypto';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function seedLossPrerequisites(companyId: string) {
  const userId = (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Func', $1, 'x', 'employee', $2) RETURNING id`,
      [`func-${companyId}@teste.local`, companyId],
    )
  )[0].id as string;
  const locationId = (
    await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId])
  )[0].id as string;
  const reasonId = (
    await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId])
  )[0].id as string;
  return { userId, locationId, reasonId };
}

describe('endurecimento dos triggers de valor (migration 1700000013000)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('usuário inexistente em app.current_user_id (token de usuário excluído) não quebra a edição de preço', async () => {
    const companyId = await seedCompany('Empresa Token Velho');
    const productId = await seedProduct({ companyId, barcode: '5001', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId, userId: randomUUID() }, (manager) =>
      manager.query(`UPDATE products SET "unitPrice" = 11 WHERE id = $1`, [productId]),
    );

    const rows = await adminQuery(
      `SELECT "unitPrice", "changedByUserId" FROM product_price_history WHERE "productId" = $1 ORDER BY seq`,
      [productId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ unitPrice: '11.00', changedByUserId: null });
  });

  it('fallback parcial: preço explícito é mantido, só o custo ausente vem do produto', async () => {
    const companyId = await seedCompany('Empresa Parcial');
    const productId = await seedProduct({ companyId, barcode: '5002', unitPrice: 25, costPrice: 15 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyId);

    const lossId = (
      await withTenant({ companyId }, (manager) =>
        manager.query(
          `INSERT INTO losses
             ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId",
              "occurredAt", "unitPriceAtLoss")
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now(), 99.99)
           RETURNING id`,
          [companyId, productId, userId, locationId, reasonId],
        ),
      )
    )[0].id;

    const [loss] = await adminQuery(
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '99.99', unitCostAtLoss: '15.00', valuationSource: 'fallback_current' });
  });

  it('as duas funções de trigger têm search_path fixo (não dependem de quem as chama)', async () => {
    const rows = await adminQuery(
      `SELECT proname, array_to_string(proconfig, ',') AS config
         FROM pg_proc
        WHERE proname IN ('record_product_price_history', 'losses_valuation_fallback')
        ORDER BY proname`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.config).toMatch(/search_path=public,\s*pg_temp/);
    }
  });
});

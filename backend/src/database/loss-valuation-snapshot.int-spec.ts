import { getTestDbConfig } from '../test-utils/test-db-config';
import { createTestDatabase, dropTestDatabase, queryAsAdmin, runMigrations } from '../test-utils/test-db-lifecycle';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function insertLoss(params: {
  companyId: string;
  productId: string;
  locationId: string;
  reasonId: string;
  userId: string;
}): Promise<string> {
  const rows = await withTenant({ companyId: params.companyId }, (manager) =>
    manager.query(
      `INSERT INTO losses
         ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId", "occurredAt")
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now())
       RETURNING id`,
      [params.companyId, params.productId, params.userId, params.locationId, params.reasonId],
    ),
  );
  return rows[0].id;
}

/** Cria o mínimo que uma perda exige (usuário, local, motivo) direto por SQL — sem depender de entidade nova. */
async function seedLossPrerequisites(companyId: string) {
  const userId = (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', 'employee', $3) RETURNING id`,
      ['Funcionário de teste', `func-${companyId}@teste.local`, companyId],
    )
  )[0].id;
  const locationId = (
    await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId])
  )[0].id;
  const reasonId = (
    await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId])
  )[0].id;
  return { userId, locationId, reasonId };
}

describe('losses — valor congelado: trigger de segurança e restrições', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('perda inserida SEM valor congelado é preenchida pelo trigger com o preço atual do produto', async () => {
    const companyId = await seedCompany('Empresa Fallback');
    const productId = await seedProduct({ companyId, barcode: '3001', unitPrice: 25, costPrice: 15 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyId);

    const lossId = await insertLoss({ companyId, productId, locationId, reasonId, userId });

    const [loss] = await adminQuery(
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '25.00', unitCostAtLoss: '15.00', valuationSource: 'fallback_current' });
  });

  it('perda inserida COM valor congelado explícito não é sobrescrita pelo trigger', async () => {
    const companyId = await seedCompany('Empresa Explícito');
    const productId = await seedProduct({ companyId, barcode: '3002', unitPrice: 25, costPrice: 15 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyId);

    const lossId = (
      await withTenant({ companyId }, (manager) =>
        manager.query(
          `INSERT INTO losses
             ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId",
              "occurredAt", "unitPriceAtLoss", "unitCostAtLoss", "valuationSource")
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now(), 999.99, 888.88, 'snapshot')
           RETURNING id`,
          [companyId, productId, userId, locationId, reasonId],
        ),
      )
    )[0].id;

    const [loss] = await adminQuery(
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '999.99', unitCostAtLoss: '888.88', valuationSource: 'snapshot' });
  });

  it('perda referenciando produto de OUTRA empresa falha alto (NOT NULL), não grava valor zerado', async () => {
    const companyA = await seedCompany('Empresa A Cruzada');
    const companyB = await seedCompany('Empresa B Cruzada');
    const productOfB = await seedProduct({ companyId: companyB, barcode: '3003', unitPrice: 40, costPrice: 20 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyA);

    // O FK não impede o cruzamento (não sabe de tenant); a sessão de A não enxerga o produto de B via
    // RLS, então o SELECT do trigger vem vazio e a coluna NOT NULL barra o INSERT — falha alto em vez
    // de gravar um prejuízo de R$ 0,00 por engano.
    await expect(insertLoss({ companyId: companyA, productId: productOfB, locationId, reasonId, userId })).rejects.toThrow(
      /null value in column "unitPriceAtLoss"/,
    );
  });
});

describe('losses — backfill do valor congelado (banco próprio, migração em etapas)', () => {
  const cfg = getTestDbConfig('loss_valuation_backfill_test');

  afterAll(() => dropTestDatabase(cfg));

  it('toda perda já existente ganha unitPriceAtLoss/unitCostAtLoss = preço atual do produto, em TODAS as empresas', async () => {
    // Até a 1700000011000 inclusive: cria o produto/histórico, mas ainda SEM as colunas de valor
    // congelado em losses — "legado" = perdas registradas antes desta migration existir.
    await createTestDatabase(cfg, { migrateUpTo: '1700000011000' });

    const companyId = (await queryAsAdmin(cfg, `INSERT INTO companies (name, status) VALUES ('C', 'active') RETURNING id`))[0].id;
    const userId = (
      await queryAsAdmin(
        cfg,
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('U', 'u-loss-backfill@teste.local', 'x', 'employee', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const locationId = (await queryAsAdmin(cfg, `INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Local') RETURNING id`, [companyId]))[0].id;
    const reasonId = (await queryAsAdmin(cfg, `INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Motivo') RETURNING id`, [companyId]))[0].id;
    const productId = (
      await queryAsAdmin(
        cfg,
        `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice") VALUES ($1, 'legado-loss', 'Legado', 50, 30) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const lossId = (
      await queryAsAdmin(
        cfg,
        `INSERT INTO losses ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId", "occurredAt")
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now()) RETURNING id`,
        [companyId, productId, userId, locationId, reasonId],
      )
    )[0].id;

    await runMigrations(cfg);

    const [loss] = await queryAsAdmin(
      cfg,
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '50.00', unitCostAtLoss: '30.00', valuationSource: 'backfill_current' });
  });
});

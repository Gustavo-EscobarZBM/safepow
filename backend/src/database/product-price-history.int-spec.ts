import { getTestDbConfig } from '../test-utils/test-db-config';
import { createTestDatabase, dropTestDatabase, queryAsAdmin, queryAsOwner, runMigrations } from '../test-utils/test-db-lifecycle';
import { Company } from '../modules/companies/company.entity';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function historyRows(productId: string): Promise<
  { unitPrice: string; costPrice: string; source: string; changedByUserId: string | null }[]
> {
  return adminQuery(
    `SELECT "unitPrice", "costPrice", source, "changedByUserId"
       FROM product_price_history WHERE "productId" = $1 ORDER BY seq ASC`,
    [productId],
  );
}

describe('product_price_history — trigger em products e RLS', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('criar um produto gera exatamente 1 linha de histórico', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1001', unitPrice: 10, costPrice: 6 });

    const rows = await historyRows(productId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unitPrice: '10.00', costPrice: '6.00', source: 'manual' });
  });

  it('mudar o preço ou o custo gera outra linha', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1002', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId }, (manager) =>
      manager.query(`UPDATE products SET "unitPrice" = 12 WHERE id = $1`, [productId]),
    );

    const rows = await historyRows(productId);
    expect(rows).toHaveLength(2);
    expect(rows[1].unitPrice).toBe('12.00');
  });

  it('mudar outro campo (não preço/custo) NÃO gera linha nova', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1003', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId }, (manager) =>
      manager.query(`UPDATE products SET name = 'Outro nome' WHERE id = $1`, [productId]),
    );

    expect(await historyRows(productId)).toHaveLength(1);
  });

  it('gravar o MESMO preço de novo NÃO gera linha nova', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1004', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId }, (manager) =>
      manager.query(`UPDATE products SET "unitPrice" = 10 WHERE id = $1`, [productId]),
    );

    expect(await historyRows(productId)).toHaveLength(1);
  });

  it('changedByUserId e source vêm das variáveis de sessão (app.current_user_id / app.change_source)', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const userId = await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', 'manager', $3) RETURNING id`,
      ['Gerente de teste', 'gerente-price-history@teste.local', companyId],
    ).then((rows) => rows[0].id as string);
    const productId = await seedProduct({ companyId, barcode: '1005', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId, userId }, async (manager) => {
      await manager.query(`SELECT set_config('app.change_source', 'import', true)`);
      await manager.query(`UPDATE products SET "unitPrice" = 15 WHERE id = $1`, [productId]);
    });

    const rows = await historyRows(productId);
    expect(rows[1]).toMatchObject({ source: 'import', changedByUserId: userId });
  });

  it('excluir a empresa (como companies.remove) apaga o histórico em cascata, apesar do GRANT só de SELECT/INSERT', async () => {
    const companyId = await seedCompany('Empresa Excluída');
    const outra = await seedCompany('Empresa Que Fica');
    const userId = await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', 'manager', $3) RETURNING id`,
      ['Gerente excluído', 'gerente-excluido@teste.local', companyId],
    ).then((rows) => rows[0].id as string);
    const productId = await seedProduct({ companyId, barcode: '4001', unitPrice: 10, costPrice: 6 });
    await seedProduct({ companyId: outra, barcode: '4002' });
    // Linha com changedByUserId preenchido: exercita também o FK ON DELETE SET NULL vindo de users.
    await withTenant({ companyId, userId }, (manager) =>
      manager.query(`UPDATE products SET "unitPrice" = 11 WHERE id = $1`, [productId]),
    );

    // Mesmo caminho de CompaniesService.remove: role de runtime, tenant = a própria empresa.
    await withTenant({ companyId }, (manager) => manager.delete(Company, companyId));

    const restantes = await adminQuery(`SELECT "companyId" FROM product_price_history`);
    expect(restantes).toHaveLength(1);
    expect(restantes[0].companyId).toBe(outra);
  });

  it('a empresa A não enxerga histórico de preço da empresa B (RLS)', async () => {
    const a = await seedCompany('Empresa A Preço');
    const b = await seedCompany('Empresa B Preço');
    await seedProduct({ companyId: a, barcode: '2001' });
    await seedProduct({ companyId: b, barcode: '2002' });

    const visiveisParaA = await withTenant({ companyId: a }, (manager) =>
      manager.query('SELECT "companyId" FROM product_price_history'),
    );

    expect(visiveisParaA).toHaveLength(1);
    expect(visiveisParaA[0].companyId).toBe(a);
  });
});

describe('product_price_history — backfill (banco próprio, migração em etapas)', () => {
  const cfg = getTestDbConfig('product_price_history_backfill_test');

  afterAll(() => dropTestDatabase(cfg));

  it('todo produto já existente ganha 1 linha de histórico com o preço atual, em TODAS as empresas', async () => {
    // Banco só até a sub-etapa 1.2.1 (inclui a correção do F18, sem a qual o backfill abaixo já
    // falharia por outro motivo) — "legado" = produtos criados ANTES do trigger existir.
    await createTestDatabase(cfg, { migrateUpTo: '1700000010000' });

    const companyA = (await queryAsAdmin(cfg, `INSERT INTO companies (name, status) VALUES ('A', 'active') RETURNING id`))[0].id;
    const companyB = (await queryAsAdmin(cfg, `INSERT INTO companies (name, status) VALUES ('B', 'active') RETURNING id`))[0].id;
    const productA = (await queryAsAdmin(
      cfg,
      `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice") VALUES ($1, 'legado-a', 'Legado A', 20, 12) RETURNING id`,
      [companyA],
    ))[0].id;
    const productB = (await queryAsAdmin(
      cfg,
      `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice") VALUES ($1, 'legado-b', 'Legado B', 30, 18) RETURNING id`,
      [companyB],
    ))[0].id;

    // Sem withoutForcedRls, a migration rodando como dono falharia aqui (WITH CHECK) ou não veria
    // nenhum produto (USING) — as asserções abaixo provam que o backfill alcançou as DUAS empresas.
    await runMigrations(cfg);

    const rows = await queryAsAdmin(
      cfg,
      `SELECT "companyId", "productId", "unitPrice", "costPrice", source FROM product_price_history ORDER BY "productId"`,
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ companyId: companyA, productId: productA, unitPrice: '20.00', source: 'backfill' }),
        expect.objectContaining({ companyId: companyB, productId: productB, unitPrice: '30.00', source: 'backfill' }),
      ]),
    );

    // Confere também que o helper religou FORCE ao final — o dono não deve enxergar nada sem tenant.
    const comoDono = await queryAsOwner(cfg, 'SELECT count(*)::int AS n FROM product_price_history');
    expect(comoDono[0].n).toBe(0);
  });
});

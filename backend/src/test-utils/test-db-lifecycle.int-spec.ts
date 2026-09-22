import { getTestDbConfig, TEST_OWNER_ROLE } from './test-db-config';
import { createTestDatabase, dropTestDatabase, queryAsAdmin, runMigrations } from './test-db-lifecycle';

// Banco PRÓPRIO deste arquivo: "inventory_saas_test" pertence ao globalSetup e aos demais testes.
const cfg = getTestDbConfig('inventory_saas_harness_test');

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await queryAsAdmin(
    cfg,
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length === 1;
}

describe('harness — banco de teste, migrations em etapas e privilégios', () => {
  afterAll(() => dropTestDatabase(cfg));

  it('migra só até o ponto pedido e depois aplica o restante', async () => {
    await createTestDatabase(cfg, { migrateUpTo: '1700000004000' });
    expect(await hasColumn('losses', 'reasonId')).toBe(true); // migration 4000 já rodou
    expect(await hasColumn('companies', 'lossVerificationEnabled')).toBe(false); // 9000 ainda não

    await runMigrations(cfg);
    expect(await hasColumn('companies', 'lossVerificationEnabled')).toBe(true);
  });

  it('reproduz o ambiente real: dono sem superusuário, FORCE RLS e privilégios do role de runtime', async () => {
    await createTestDatabase(cfg);

    const [table] = await queryAsAdmin(
      cfg,
      `SELECT t.tableowner AS owner, c.relforcerowsecurity AS forced
         FROM pg_tables t JOIN pg_class c ON c.oid = ('public.' || t.tablename)::regclass
        WHERE t.schemaname = 'public' AND t.tablename = 'products'`,
    );
    expect(table.owner).toBe(TEST_OWNER_ROLE);
    expect(table.forced).toBe(true);

    const [privileges] = await queryAsAdmin(
      cfg,
      `SELECT has_table_privilege($1, 'public.products', 'SELECT')   AS "select",
              has_table_privilege($1, 'public.products', 'INSERT')   AS "insert",
              has_table_privilege($1, 'public.products', 'UPDATE')   AS "update",
              has_table_privilege($1, 'public.products', 'DELETE')   AS "delete",
              has_table_privilege($1, 'public.products', 'TRUNCATE') AS "truncate"`,
      [cfg.appUser],
    );
    expect(privileges).toEqual({ select: true, insert: true, update: true, delete: true, truncate: false });
  });
});

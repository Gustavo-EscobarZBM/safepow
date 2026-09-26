import { adminQuery, closeTestConnections, seedCompany, truncateAll, withTenant } from '../../test-utils/test-db';

async function seedJob(companyId: string, status?: string): Promise<string> {
  const rows = status
    ? await adminQuery(
        `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status) VALUES ($1, 'p.xlsx', 'k', $2) RETURNING id`,
        [companyId, status],
      )
    : await adminQuery(`INSERT INTO import_jobs ("companyId", "fileName", "storageKey") VALUES ($1, 'p.xlsx', 'k') RETURNING id`, [
        companyId,
      ]);
  return rows[0].id;
}

describe('Schema da importação 2.0 (SP3, migration 18000)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it.each(['import_rows', 'import_mappings'])('%s tem RLS ligada e forçada', async (table) => {
    const [row] = await adminQuery(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`, [table]);
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('import_rows isola por empresa (USING e WITH CHECK)', async () => {
    const a = await seedCompany('A');
    const b = await seedCompany('B');
    const jobA = await seedJob(a);
    const jobB = await seedJob(b);
    await adminQuery(`INSERT INTO import_rows ("companyId", "jobId", "rowNumber", action) VALUES ($1, $2, 2, 'create')`, [b, jobB]);

    await withTenant({ companyId: a }, async (manager) => {
      expect(await manager.query(`SELECT * FROM import_rows`)).toHaveLength(0);
    });
    await expect(
      withTenant({ companyId: a }, (manager) =>
        manager.query(`INSERT INTO import_rows ("companyId", "jobId", "rowNumber", action) VALUES ($1, $2, 2, 'create')`, [b, jobB]),
      ),
    ).rejects.toThrow(/row-level security/);
    await withTenant({ companyId: a }, (manager) =>
      manager.query(`INSERT INTO import_rows ("companyId", "jobId", "rowNumber", action) VALUES ($1, $2, 2, 'create')`, [a, jobA]),
    );
  });

  it('import_jobs.status: padrão uploaded, aceita os novos, recusa desconhecido e mantém os antigos', async () => {
    const companyId = await seedCompany('A');
    const id = await seedJob(companyId);
    expect((await adminQuery(`SELECT status FROM import_jobs WHERE id = $1`, [id]))[0].status).toBe('uploaded');
    await seedJob(companyId, 'simulated');
    await seedJob(companyId, 'completed');
    await expect(seedJob(companyId, 'xyz')).rejects.toThrow(/check constraint/);
  });

  it('import_mappings: nome único por empresa e recurso', async () => {
    const companyId = await seedCompany('A');
    const insert = () =>
      adminQuery(
        `INSERT INTO import_mappings ("companyId", resource, name, mapping, "headerFingerprint") VALUES ($1, 'products', 'ERP', '{}', $2)`,
        [companyId, 'f'.repeat(64)],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('histórico de preço aceita source = import_rollback', async () => {
    const companyId = await seedCompany('A');
    const productId = (
      await adminQuery(`INSERT INTO products ("companyId", barcode, name) VALUES ($1, '1', 'P') RETURNING id`, [companyId])
    )[0].id;
    await adminQuery(
      `INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", source)
       VALUES ($1, $2, 1, 1, now(), 'import_rollback')`,
      [companyId, productId],
    );
  });
});

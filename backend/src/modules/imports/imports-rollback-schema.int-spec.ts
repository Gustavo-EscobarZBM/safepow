import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';

describe('Schema da reversão de importação (SP3, migration 19000)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('import_rows.rollbackResult aceita restored/conflict e recusa outro valor', async () => {
    const companyId = await seedCompany('A');
    const [{ id: jobId }] = await adminQuery(
      `INSERT INTO import_jobs ("companyId", "fileName", "storageKey") VALUES ($1, 'p.xlsx', 'k') RETURNING id`,
      [companyId],
    );
    const insert = (value: string) =>
      adminQuery(`INSERT INTO import_rows ("companyId", "jobId", action, "rollbackResult") VALUES ($1, $2, 'create', $3)`, [
        companyId,
        jobId,
        value,
      ]);
    await insert('restored');
    await insert('conflict');
    await expect(insert('x')).rejects.toThrow(/check constraint/);
  });

  it("audit_log aceita a ação 'rollback'", async () => {
    const companyId = await seedCompany('B');
    await adminQuery(
      `INSERT INTO audit_log ("companyId", "entityType", action) VALUES ($1, 'import_job', 'rollback')`,
      [companyId],
    );
    expect(await adminQuery(`SELECT 1 FROM audit_log WHERE "companyId" = $1 AND action = 'rollback'`, [companyId])).toHaveLength(1);
  });
});

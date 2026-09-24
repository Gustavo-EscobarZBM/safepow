import { adminQuery, closeTestConnections } from '../test-utils/test-db';

describe('índice do sync de produtos (migration 1700000014000)', () => {
  afterAll(() => closeTestConnections());

  it('existe um índice em products (companyId, updatedAt, id)', async () => {
    const rows = await adminQuery(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'products' AND indexname = 'idx_products_company_updated_id'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('("companyId", "updatedAt", id)');
  });
});

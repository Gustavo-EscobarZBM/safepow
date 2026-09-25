import { adminQuery, closeTestConnections, seedCompany, truncateAll, withTenant } from '../test-utils/test-db';

async function insertRequest(companyId: string): Promise<{ id: string; status: string; ttl: { days?: number } }> {
  const [row] = await adminQuery(
    `INSERT INTO change_requests ("companyId", policy, "entityType", "entityId", operation, payload, snapshot, justification)
     VALUES ($1, 'price_change', 'product', gen_random_uuid(), 'update', '{}', '{}', 'Justificativa de teste') RETURNING id, status, "expiresAt" - "createdAt" AS ttl`,
    [companyId],
  );
  return row;
}

describe('migration 1700000017000 — políticas e pedidos de aprovação', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('companies.approvalPolicies nasce como {} (tudo desligado)', async () => {
    const companyId = await seedCompany('Empresa Políticas');
    const [row] = await adminQuery(`SELECT "approvalPolicies" FROM companies WHERE id = $1`, [companyId]);
    expect(row.approvalPolicies).toEqual({});
  });

  it('pedido nasce pendente e vence em 7 dias', async () => {
    const companyId = await seedCompany('Empresa Pedido');
    const row = await insertRequest(companyId);
    expect(row.status).toBe('pending');
    expect(row.ttl).toMatchObject({ days: 7 });
  });

  it('RLS: cada empresa só enxerga os próprios pedidos', async () => {
    const a = await seedCompany('A');
    const b = await seedCompany('B');
    await insertRequest(a);
    await insertRequest(b);

    const seenByA = await withTenant({ companyId: a }, (m) => m.query(`SELECT "companyId" FROM change_requests`));
    expect(seenByA).toEqual([{ companyId: a }]);
  });

  it('role da aplicação atualiza status mas não apaga pedidos', async () => {
    const companyId = await seedCompany('Empresa Status');
    const row = await insertRequest(companyId);

    await withTenant({ companyId }, (m) => m.query(`UPDATE change_requests SET status = 'cancelled' WHERE id = $1`, [row.id]));
    expect((await adminQuery(`SELECT status FROM change_requests WHERE id = $1`, [row.id]))[0].status).toBe('cancelled');

    await expect(
      withTenant({ companyId }, (m) => m.query(`DELETE FROM change_requests WHERE id = $1`, [row.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it('só um pedido pendente por entidade + política', async () => {
    const companyId = await seedCompany('Empresa Único');
    const entityId = (await adminQuery(`SELECT gen_random_uuid() AS id`))[0].id;
    const insert = () =>
      adminQuery(
        `INSERT INTO change_requests ("companyId", policy, "entityType", "entityId", operation, payload, snapshot, justification)
         VALUES ($1, 'loss_edit', 'loss', $2, 'update', '{}', '{}', 'Justificativa de teste')`,
        [companyId, entityId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('status e política fora da lista são recusados', async () => {
    const companyId = await seedCompany('Empresa Check');
    await expect(
      adminQuery(
        `INSERT INTO change_requests ("companyId", policy, "entityType", operation, payload, snapshot, justification)
         VALUES ($1, 'qualquer', 'product', 'update', '{}', '{}', 'Justificativa de teste')`,
        [companyId],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

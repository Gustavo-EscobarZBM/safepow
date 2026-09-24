import { randomUUID } from 'crypto';
import {
  adminQuery,
  appDataSource,
  closeTestConnections,
  seedCompany,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function seedUser(companyId: string, name: string, role = 'manager'): Promise<string> {
  return (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [name, `${randomUUID()}@teste.local`, role, companyId],
    )
  )[0].id;
}

function callAuditInsert(manager: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, companyId: string) {
  return manager.query(
    `SELECT audit_insert($1, 'product', $2, 'Arroz', 'update', '[{"field":"name","from":"A","to":"B"}]'::jsonb, NULL)`,
    [companyId, randomUUID()],
  );
}

describe('audit_log e audit_insert (migration 1700000015000)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('grava ator (nome e papel no momento), origem, requestId, IP e justificativa das variáveis de sessão', async () => {
    const companyId = await seedCompany('Empresa Audit');
    const userId = await seedUser(companyId, 'Maria Gerente');
    const requestId = randomUUID();

    await withTenant({ companyId, userId }, async (manager) => {
      await manager.query(
        `SELECT set_config('app.audit_source', 'mobile', true), set_config('app.request_id', $1, true),
                set_config('app.client_ip', '10.0.0.7', true), set_config('app.audit_reason', 'erro de digitação', true)`,
        [requestId],
      );
      await callAuditInsert(manager, companyId);
    });

    const [row] = await adminQuery(`SELECT * FROM audit_log`);
    expect(row).toMatchObject({
      companyId,
      actorUserId: userId,
      actorName: 'Maria Gerente',
      actorRole: 'manager',
      entityType: 'product',
      entityLabel: 'Arroz',
      action: 'update',
      changes: [{ field: 'name', from: 'A', to: 'B' }],
      source: 'mobile',
      reason: 'erro de digitação',
      requestId,
      ip: '10.0.0.7',
    });
  });

  it('sem contexto nenhum: ator NULL e origem system', async () => {
    const companyId = await seedCompany('Empresa Sistema');

    await callAuditInsert(await appDataSource(), companyId);

    const [row] = await adminQuery(`SELECT "actorUserId", "actorName", source FROM audit_log`);
    expect(row).toEqual({ actorUserId: null, actorName: null, source: 'system' });
  });

  it('grava com a empresa da linha mesmo fora de contexto de tenant, e restaura o contexto anterior', async () => {
    const companyId = await seedCompany('Empresa Sem Tenant');
    const ds = await appDataSource();

    const [{ after }] = await ds.transaction(async (manager) => {
      await callAuditInsert(manager, companyId);
      return manager.query(`SELECT current_setting('app.current_company_id', true) AS after`);
    });

    expect(await adminQuery(`SELECT "companyId" FROM audit_log`)).toEqual([{ companyId }]);
    expect(after ?? '').toBe('');
  });

  it('empresa inexistente (sendo excluída): não grava nada', async () => {
    await callAuditInsert(await appDataSource(), randomUUID());
    expect(await adminQuery(`SELECT id FROM audit_log`)).toHaveLength(0);
  });

  it('append-only: o role da aplicação não consegue alterar nem apagar, nem na própria empresa', async () => {
    const companyId = await seedCompany('Empresa Append');
    await withTenant({ companyId }, (manager) => callAuditInsert(manager, companyId));

    await expect(
      withTenant({ companyId }, (manager) => manager.query(`UPDATE audit_log SET reason = 'apagando rastro'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(withTenant({ companyId }, (manager) => manager.query(`DELETE FROM audit_log`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('RLS: uma empresa não lê a auditoria da outra', async () => {
    const a = await seedCompany('Empresa A Audit');
    const b = await seedCompany('Empresa B Audit');
    await withTenant({ companyId: a }, (manager) => callAuditInsert(manager, a));
    await withTenant({ companyId: b }, (manager) => callAuditInsert(manager, b));

    const visible = await withTenant({ companyId: a }, (manager) => manager.query(`SELECT "companyId" FROM audit_log`));

    expect(visible).toEqual([{ companyId: a }]);
  });
});

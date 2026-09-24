import { randomUUID } from 'crypto';
import { Company } from '../modules/companies/company.entity';
import {
  adminQuery,
  appDataSource,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function auditOf(entityId: string) {
  return adminQuery(
    `SELECT action, changes, "entityType", "entityLabel", "actorUserId" FROM audit_log WHERE "entityId" = $1 ORDER BY seq`,
    [entityId],
  );
}

async function seedUser(companyId: string, name = 'Gerente'): Promise<string> {
  return (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'hash-secreto', 'manager', $3) RETURNING id`,
      [name, `${randomUUID()}@teste.local`, companyId],
    )
  )[0].id;
}

describe('triggers de auditoria (migration 1700000016000)', () => {
  let companyId: string;
  let userId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Triggers');
    userId = await seedUser(companyId, 'Maria');
  });
  afterAll(() => closeTestConnections());

  it('produto: create, update com diff, archive, restore — com ator e nome legível', async () => {
    const productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz', unitPrice: 10 });
    await withTenant({ companyId, userId }, async (m) => {
      await m.query(`UPDATE products SET "unitPrice" = 12 WHERE id = $1`, [productId]);
      await m.query(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);
      await m.query(`UPDATE products SET "isActive" = true WHERE id = $1`, [productId]);
    });

    const rows = await auditOf(productId);
    expect(rows.map((r) => r.action)).toEqual(['create', 'update', 'archive', 'restore']);
    expect(rows[1].changes).toEqual([{ field: 'unitPrice', from: 10, to: 12 }]);
    expect(rows[1]).toMatchObject({ entityType: 'product', entityLabel: 'Arroz', actorUserId: userId });
  });

  it('UPDATE sem campo relevante mudado (só updatedAt) não grava', async () => {
    const productId = await seedProduct({ companyId, barcode: '2', name: 'Feijão' });
    await withTenant({ companyId }, (m) => m.query(`UPDATE products SET "updatedAt" = now() WHERE id = $1`, [productId]));

    expect((await auditOf(productId)).map((r) => r.action)).toEqual(['create']);
  });

  it('colunas ignoradas (sourceColumnMapping) não aparecem no diff', async () => {
    const productId = await seedProduct({ companyId, barcode: '3', name: 'Sal' });
    await withTenant({ companyId }, (m) =>
      m.query(`UPDATE products SET "sourceColumnMapping" = '{"a":"b"}' WHERE id = $1`, [productId]),
    );

    expect((await auditOf(productId)).map((r) => r.action)).toEqual(['create']);
  });

  it('usuário: senha aparece só como "alterada", nunca o hash — na criação e na troca', async () => {
    const newUser = await seedUser(companyId, 'Novo');
    await withTenant({ companyId, userId }, (m) =>
      m.query(`UPDATE users SET "passwordHash" = 'outro-hash' WHERE id = $1`, [newUser]),
    );

    const rows = await auditOf(newUser);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('hash-secreto');
    expect(text).not.toContain('outro-hash');
    expect(rows[1].changes).toEqual([{ field: 'password', from: null, to: 'alterada' }]);
  });

  it('perda: create e delete (motivo/local também)', async () => {
    const productId = await seedProduct({ companyId, barcode: '4', name: 'Óleo' });
    const reasonId = (await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId]))[0].id;
    const locationId = (await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId]))[0].id;
    const lossId = (
      await withTenant({ companyId, userId }, (m) =>
        m.query(
          `INSERT INTO losses ("companyId","clientGeneratedId","productId","reportedByUserId","locationId","reasonId","occurredAt")
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now()) RETURNING id`,
          [companyId, productId, userId, locationId, reasonId],
        ),
      )
    )[0].id;
    await withTenant({ companyId, userId }, (m) => m.query(`DELETE FROM losses WHERE id = $1`, [lossId]));

    expect((await auditOf(lossId)).map((r) => r.action)).toEqual(['create', 'delete']);
    expect((await auditOf(reasonId))[0]).toMatchObject({ entityType: 'loss_reason', entityLabel: 'Quebra', action: 'create' });
    expect((await auditOf(locationId))[0]).toMatchObject({ entityType: 'loss_location', action: 'create' });
  });

  it('faturamento mensal: rótulo ano/mês', async () => {
    const revenueId = (
      await withTenant({ companyId, userId }, (m) =>
        m.query(`INSERT INTO company_monthly_revenue ("companyId", year, month, "revenueAmount") VALUES ($1, 2026, 9, 1000) RETURNING id`, [companyId]),
      )
    )[0].id;

    expect((await auditOf(revenueId))[0]).toMatchObject({ entityType: 'company_revenue', entityLabel: '2026/09' });
  });

  it('status da empresa mudado SEM contexto de tenant (como o login faz) é auditado; colunas de cobrança não', async () => {
    const ds = await appDataSource();
    await ds.query(`UPDATE companies SET status = 'past_due', "currentPeriodEnd" = now() WHERE id = $1`, [companyId]);

    const rows = await auditOf(companyId);
    const update = rows.find((r) => r.action === 'update');
    expect(update.changes).toEqual([{ field: 'status', from: 'active', to: 'past_due' }]);
  });

  it('criar empresa + gerente como no Painel Master (sem tenant, depois com tenant) funciona e audita os dois', async () => {
    const ds = await appDataSource();
    const newCompanyId = await ds.transaction(async (m) => {
      const [company] = await m.query(`INSERT INTO companies (name, status) VALUES ('Nova', 'active') RETURNING id`);
      await m.query(`SELECT set_config('app.current_company_id', $1, true)`, [company.id]);
      await m.query(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Gerente Nova', $1, 'h', 'manager', $2)`,
        [`${randomUUID()}@teste.local`, company.id],
      );
      return company.id as string;
    });

    const rows = await adminQuery(`SELECT "entityType", action FROM audit_log WHERE "companyId" = $1 ORDER BY seq`, [newCompanyId]);
    expect(rows).toEqual([
      { entityType: 'company', action: 'create' },
      { entityType: 'user', action: 'create' },
    ]);
  });

  it('exclusão de empresa (como companies.remove) continua apagando tudo em cascata', async () => {
    await seedProduct({ companyId, barcode: '9', name: 'Vai sumir' });

    await withTenant({ companyId }, (m) => m.delete(Company, companyId));

    expect(await adminQuery(`SELECT id FROM companies WHERE id = $1`, [companyId])).toHaveLength(0);
    expect(await adminQuery(`SELECT id FROM audit_log WHERE "companyId" = $1`, [companyId])).toHaveLength(0);
  });

  it('modo resumo (app.audit_mode = summary) não grava nada na transação', async () => {
    const productId = await seedProduct({ companyId, barcode: '10', name: 'Resumo' });
    await withTenant({ companyId }, async (m) => {
      await m.query(`SELECT set_config('app.audit_mode', 'summary', true)`);
      await m.query(`UPDATE products SET name = 'Outro' WHERE id = $1`, [productId]);
    });

    expect((await auditOf(productId)).map((r) => r.action)).toEqual(['create']);
  });

  it('usuário master_admin (sem empresa) não é auditado', async () => {
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Master', $1, 'h', 'master_admin', NULL)`,
      [`${randomUUID()}@teste.local`],
    );
    expect(await adminQuery(`SELECT id FROM audit_log WHERE "entityType" = 'user' AND "entityLabel" = 'Master'`)).toHaveLength(0);
  });
});

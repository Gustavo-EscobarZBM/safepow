import { QueryRunner } from 'typeorm';
import { getTenantManager } from '../common/tenant/tenant-storage';
import { Product } from '../modules/products/product.entity';
import {
  adminQuery,
  appDataSource,
  closeTestConnections,
  ownerQuery,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

/**
 * Roda `secondTransaction` numa SEGUNDA transação, na MESMA conexão física de `firstTransaction` —
 * reproduz um pool devolvendo a conexão entre uma requisição de tenant e outra sem tenant (ex.:
 * master_admin, que nunca chama set_config). Sempre comita a segunda transação.
 */
async function onReusedConnection<T>(
  firstTransaction: (queryRunner: QueryRunner) => Promise<void>,
  secondTransaction: (queryRunner: QueryRunner) => Promise<T>,
): Promise<T> {
  const queryRunner = (await appDataSource()).createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.startTransaction();
    await firstTransaction(queryRunner);
    await queryRunner.commitTransaction();

    await queryRunner.startTransaction();
    const result = await secondTransaction(queryRunner);
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction().catch(() => undefined);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

function queryOnReusedConnection(companyId: string): Promise<unknown[]> {
  return onReusedConnection(
    (qr) => qr.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]),
    (qr) => qr.query('SELECT id FROM products'),
  );
}

/** Insere um usuário MASTER_ADMIN (companyId NULL) direto no banco — só para o teste abaixo. */
async function seedMasterAdmin(): Promise<string> {
  const rows = await adminQuery(
    `INSERT INTO users (name, email, "passwordHash", role) VALUES ($1, $2, 'x', 'master_admin') RETURNING id`,
    ['Admin de teste', 'master-admin-f18@teste.local'],
  );
  return rows[0].id;
}

describe('RLS multi-tenant — a base que todo o SP1 assume', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('a empresa A só enxerga os próprios produtos pelo role de runtime', async () => {
    const a = await seedCompany('Empresa A');
    const b = await seedCompany('Empresa B');
    await seedProduct({ companyId: a, barcode: '1111', name: 'Produto da A' });
    await seedProduct({ companyId: b, barcode: '2222', name: 'Produto da B' });

    const visiveisParaA = await withTenant({ companyId: a }, (manager) => manager.find(Product));

    expect(visiveisParaA.map((p) => p.name)).toEqual(['Produto da A']);
  });

  it('a empresa A não consegue gravar produto em nome da B (WITH CHECK)', async () => {
    const a = await seedCompany('Empresa A');
    const b = await seedCompany('Empresa B');

    await expect(
      withTenant({ companyId: a }, (manager) =>
        manager.query(`INSERT INTO products ("companyId", barcode, name) VALUES ($1, 'x', 'Intruso')`, [b]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a empresa A consegue gravar produto em nome dela mesma (controle positivo do WITH CHECK)', async () => {
    const a = await seedCompany('Empresa A');

    await withTenant({ companyId: a }, (manager) =>
      manager.query(`INSERT INTO products ("companyId", barcode, name) VALUES ($1, 'ok-5555', 'Produto válido')`, [a]),
    );

    const [{ n }] = await adminQuery('SELECT count(*)::int AS n FROM products WHERE barcode = $1', ['ok-5555']);
    expect(n).toBe(1);
  });

  it('getTenantManager() dentro de withTenant devolve o manager da mesma transação (contrato do middleware)', async () => {
    const a = await seedCompany('Empresa Contexto');
    await seedProduct({ companyId: a, barcode: '6666' });

    const viaContexto = await withTenant({ companyId: a }, async () => getTenantManager().find(Product));

    expect(viaContexto).toHaveLength(1);
  });

  it('FORCE ROW LEVEL SECURITY vale até para o dono das tabelas', async () => {
    const companyId = await seedCompany('Empresa Dona');
    await seedProduct({ companyId, barcode: '3333' });

    const [comoDono] = await ownerQuery('SELECT count(*)::int AS n FROM products');
    const [comoSuperusuario] = await adminQuery('SELECT count(*)::int AS n FROM products');

    expect(comoDono.n).toBe(0); // dono sem contexto de tenant não enxerga nada
    expect(comoSuperusuario.n).toBe(1); // o dado existe: superusuário ignora RLS
  });

  // F18, corrigido pela migration RlsReusedConnectionFix1700000010000: numa conexão reaproveitada,
  // current_setting('app.current_company_id', true) podia devolver '' (não NULL) e o cast ''::uuid
  // das políticas de RLS falhava. As políticas agora usam NULLIF(..., '') antes do cast.
  it('conexão reutilizada: sem contexto de tenant o role de runtime não recebe erro nem linhas', async () => {
    const companyId = await seedCompany('Empresa Conexão');
    await seedProduct({ companyId, barcode: '4444' });

    const rows = await queryOnReusedConnection(companyId);

    expect(rows).toEqual([]);
  });

  // Regressão específica do ramo "... IS NULL" da política de users (o NULLIF isolado não bastaria: ''
  // IS NULL é falso, então sem o segundo NULLIF as linhas de master_admin ficariam invisíveis numa
  // conexão reaproveitada, em vez de continuarem visíveis só para sessão sem tenant).
  it('conexão reutilizada: linhas de master_admin (companyId NULL) continuam visíveis para sessão sem tenant', async () => {
    const companyId = await seedCompany('Empresa Conexão Users');
    const masterAdminId = await seedMasterAdmin();

    const rows = await onReusedConnection<{ id: string }[]>(
      (qr) => qr.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]),
      (qr) => qr.query('SELECT id FROM users WHERE id = $1', [masterAdminId]),
    );

    expect(rows).toHaveLength(1);
  });

  it('appDataSource: chamadas concorrentes no primeiro uso devolvem a mesma conexão (sem pool órfão)', async () => {
    await closeTestConnections(); // volta ao estado de "primeiro uso"

    const [primeira, segunda] = await Promise.all([appDataSource(), appDataSource()]);

    // Booleano de propósito: se falhar, o Jest não tenta imprimir/comparar dois DataSource inteiros.
    expect(primeira === segunda).toBe(true);
  });
});

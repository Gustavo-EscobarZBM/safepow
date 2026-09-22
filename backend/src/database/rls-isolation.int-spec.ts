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
 * Mesma conexão física nas duas transações — como um pool devolvendo a conexão depois de uma
 * requisição de tenant e entregando-a a uma requisição sem tenant (ex.: master_admin, que não
 * define app.current_company_id). Devolve as linhas de `products` vistas pela segunda transação.
 */
async function queryOnReusedConnection(companyId: string): Promise<unknown[]> {
  const queryRunner = (await appDataSource()).createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.startTransaction();
    await queryRunner.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]);
    await queryRunner.commitTransaction();

    await queryRunner.startTransaction();
    const rows = await queryRunner.query('SELECT id FROM products');
    await queryRunner.commitTransaction();

    return rows;
  } catch (error) {
    await queryRunner.rollbackTransaction().catch(() => undefined);
    throw error;
  } finally {
    await queryRunner.release();
  }
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

  it('FORCE ROW LEVEL SECURITY vale até para o dono das tabelas', async () => {
    const companyId = await seedCompany('Empresa Dona');
    await seedProduct({ companyId, barcode: '3333' });

    const [comoDono] = await ownerQuery('SELECT count(*)::int AS n FROM products');
    const [comoSuperusuario] = await adminQuery('SELECT count(*)::int AS n FROM products');

    expect(comoDono.n).toBe(0); // dono sem contexto de tenant não enxerga nada
    expect(comoSuperusuario.n).toBe(1); // o dado existe: superusuário ignora RLS
  });

  // F18 (confirmado): numa conexão reaproveitada, current_setting('app.current_company_id', true)
  // devolve '' (não NULL) e o cast ''::uuid das políticas de RLS falha. Correção proposta (fora da
  // etapa 1.1, precisa de decisão): recriar as políticas com NULLIF(current_setting(...), '')::uuid.
  // Quando for corrigido, este teste passará a "falhar" como it.failing — troque para it().
  it.failing('conexão reutilizada: sem contexto de tenant o role de runtime não recebe erro nem linhas', async () => {
    const companyId = await seedCompany('Empresa Conexão');
    await seedProduct({ companyId, barcode: '4444' });

    const rows = await queryOnReusedConnection(companyId);

    expect(rows).toEqual([]);
  });

  // Fixa o estado ATUAL do F18. O it.failing acima passa com qualquer falha (inclusive um vazamento
  // de linhas entre tenants, muito pior que o erro de cast); este teste só passa com o erro do F18.
  // Quando o F18 for corrigido, este teste começa a falhar: apague-o e volte o it.failing para it().
  it('F18 (estado atual): conexão reutilizada sem tenant falha com "invalid input syntax for type uuid"', async () => {
    const companyId = await seedCompany('Empresa Conexão');
    await seedProduct({ companyId, barcode: '4444' });

    await expect(queryOnReusedConnection(companyId)).rejects.toThrow(/invalid input syntax for type uuid/);
  });

  it('appDataSource: chamadas concorrentes no primeiro uso devolvem a mesma conexão (sem pool órfão)', async () => {
    await closeTestConnections(); // volta ao estado de "primeiro uso"

    const [primeira, segunda] = await Promise.all([appDataSource(), appDataSource()]);

    // Booleano de propósito: se falhar, o Jest não tenta imprimir/comparar dois DataSource inteiros.
    expect(primeira === segunda).toBe(true);
  });
});

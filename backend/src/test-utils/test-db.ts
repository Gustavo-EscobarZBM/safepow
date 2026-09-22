import { DataSource, EntityManager } from 'typeorm';
import { tenantStorage } from '../common/tenant/tenant-storage';
import { ENTITIES } from '../database/entities';
import { UserRole } from '../modules/users/user.entity';
import { getTestDbConfig, TestDbConfig } from './test-db-config';
import { queryAsAdmin, queryAsOwner } from './test-db-lifecycle';

let cachedConfig: TestDbConfig | undefined;

/** Config do banco de testes compartilhado (`inventory_saas_test`, criado pelo globalSetup). */
export function testDbConfig(): TestDbConfig {
  cachedConfig ??= getTestDbConfig();
  return cachedConfig;
}

// Guarda a PROMESSA (não o valor resolvido): duas chamadas concorrentes no primeiro uso
// (ex.: Promise.all com dois withTenant) compartilham a mesma inicialização, sem pool órfão.
let cachedAppDataSource: Promise<DataSource> | undefined;

/** Conexão com o role de RUNTIME (sem BYPASSRLS): é nela que a RLS realmente vale. */
export async function appDataSource(): Promise<DataSource> {
  if (!cachedAppDataSource) {
    const cfg = testDbConfig();
    const dataSource = new DataSource({
      type: 'postgres',
      host: cfg.host,
      port: cfg.port,
      username: cfg.appUser,
      password: cfg.appPassword,
      database: cfg.database,
      entities: ENTITIES,
      synchronize: false,
      logging: false,
    });
    const initializing = dataSource.initialize().catch((error) => {
      // Falhou (ex.: Postgres fora do ar): limpa o cache para uma chamada posterior poder tentar de novo.
      if (cachedAppDataSource === initializing) cachedAppDataSource = undefined;
      throw error;
    });
    cachedAppDataSource = initializing;
  }
  return cachedAppDataSource;
}

/** Superusuário: ignora RLS. Só para semear e inspecionar. */
export function adminQuery(sql: string, params: unknown[] = []): Promise<any[]> {
  return queryAsAdmin(testDbConfig(), sql, params);
}

/** Dono das tabelas (sem superusuário): FORCE RLS vale para ele. */
export function ownerQuery(sql: string, params: unknown[] = []): Promise<any[]> {
  return queryAsOwner(testDbConfig(), sql, params);
}

export async function closeTestConnections(): Promise<void> {
  const pending = cachedAppDataSource;
  cachedAppDataSource = undefined;
  if (!pending) return;
  // Espera uma inicialização em andamento terminar; se ela falhou, não há nada a destruir.
  const dataSource = await pending.catch(() => undefined);
  if (dataSource?.isInitialized) await dataSource.destroy();
}

/**
 * Executa `fn` como uma requisição de tenant: transação no role de runtime, contexto de
 * tenant definido (a política de RLS enxerga só a empresa) e `tenantStorage` populado,
 * exatamente como o TenantContextMiddleware faz. Faz commit se `fn` resolver, rollback se lançar.
 */
export async function withTenant<T>(
  ctx: { companyId: string; userId?: string; role?: UserRole },
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const queryRunner = (await appDataSource()).createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`SELECT set_config('app.current_company_id', $1, true)`, [ctx.companyId]);
    if (ctx.userId) {
      await queryRunner.query(`SELECT set_config('app.current_user_id', $1, true)`, [ctx.userId]);
    }
    const result = await tenantStorage.run(
      {
        userId: ctx.userId ?? '',
        role: ctx.role ?? UserRole.MANAGER,
        companyId: ctx.companyId,
        manager: queryRunner.manager,
      },
      () => fn(queryRunner.manager),
    );
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction().catch(() => undefined);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

export async function seedCompany(name: string): Promise<string> {
  const rows = await adminQuery(`INSERT INTO companies (name, status) VALUES ($1, 'active') RETURNING id`, [name]);
  return rows[0].id;
}

export async function seedProduct(input: {
  companyId: string;
  barcode: string;
  name?: string;
  unitPrice?: number;
  costPrice?: number;
}): Promise<string> {
  const rows = await adminQuery(
    `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice")
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.companyId, input.barcode, input.name ?? 'Produto de teste', input.unitPrice ?? 0, input.costPrice ?? 0],
  );
  return rows[0].id;
}

/** Apaga todos os dados de tenant (CASCADE a partir de companies alcança toda tabela com FK). */
export async function truncateAll(): Promise<void> {
  await adminQuery('TRUNCATE TABLE companies CASCADE');
}

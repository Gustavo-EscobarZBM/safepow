import { readdirSync } from 'fs';
import { join, resolve } from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { assertTestDatabaseName, TestDbConfig } from './test-db-config';

const MIGRATIONS_DIR = resolve(__dirname, '../database/migrations');

interface Credentials {
  user: string;
  password: string;
  database: string;
}

async function connect(cfg: TestDbConfig, credentials: Credentials): Promise<Client> {
  const client = new Client({ host: cfg.host, port: cfg.port, ...credentials });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Não foi possível conectar ao Postgres de teste em ${cfg.host}:${cfg.port} ` +
        `(${(error as Error).message}). Suba-o com "docker compose up -d postgres" na pasta backend.`,
    );
  }
  return client;
}

async function queryWith(cfg: TestDbConfig, credentials: Credentials, sql: string, params: unknown[]): Promise<any[]> {
  // TestDbConfig é um objeto comum: sem esta checagem, `{ ...cfg, database: 'inventory_saas' }`
  // executaria SQL arbitrário como superusuário/dono no banco de desenvolvimento.
  assertTestDatabaseName(cfg.database);
  const client = await connect(cfg, credentials);
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** Superusuário: ignora RLS. Só para semear dados e inspecionar o estado do banco. */
export function queryAsAdmin(cfg: TestDbConfig, sql: string, params: unknown[] = []): Promise<any[]> {
  return queryWith(cfg, { user: cfg.adminUser, password: cfg.adminPassword, database: cfg.database }, sql, params);
}

/** Dono do banco de teste (sem superusuário): FORCE ROW LEVEL SECURITY vale para ele. */
export function queryAsOwner(cfg: TestDbConfig, sql: string, params: unknown[] = []): Promise<any[]> {
  return queryWith(cfg, { user: cfg.ownerUser, password: cfg.ownerPassword, database: cfg.database }, sql, params);
}

/**
 * Carrega as classes de migration reais, em ordem. `upTo` é o prefixo numérico
 * (inclusive), ex.: '1700000004000' — permite semear dados "legados" antes de
 * aplicar as migrations novas.
 */
export function loadMigrationClasses(upTo?: string): Function[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{13}-.+\.ts$/.test(file))
    .sort()
    .filter((file) => upTo === undefined || file.slice(0, 13) <= upTo)
    .map((file) => {
      const exported = require(join(MIGRATIONS_DIR, file));
      const migration = Object.values(exported).find((value) => typeof value === 'function');
      if (!migration) throw new Error(`Nenhuma classe de migration exportada em ${file}`);
      return migration as Function;
    });
}

/** Aplica as migrations pendentes como DONO NÃO SUPERUSUÁRIO (imita banco gerenciado). */
export async function runMigrations(cfg: TestDbConfig, upTo?: string): Promise<void> {
  assertTestDatabaseName(cfg.database);
  const dataSource = new DataSource({
    type: 'postgres',
    host: cfg.host,
    port: cfg.port,
    username: cfg.ownerUser,
    password: cfg.ownerPassword,
    database: cfg.database,
    entities: [],
    migrations: loadMigrationClasses(upTo),
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

async function dropDatabase(maintenance: Client, database: string): Promise<void> {
  await maintenance.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [database],
  );
  await maintenance.query(`DROP DATABASE IF EXISTS "${database}"`);
}

export async function dropTestDatabase(cfg: TestDbConfig): Promise<void> {
  assertTestDatabaseName(cfg.database);
  const maintenance = await connect(cfg, { user: cfg.adminUser, password: cfg.adminPassword, database: 'postgres' });
  try {
    await dropDatabase(maintenance, cfg.database);
  } finally {
    await maintenance.end();
  }
}

/**
 * Recria o banco de teste do zero, com o mesmo modelo de privilégios do ambiente real
 * (docker/init-db/001-create-app-role.sql): dono sem superusuário; role de runtime sem
 * BYPASSRLS com privilégios padrão de CRUD. Privilégios padrão são POR BANCO, então o
 * script de init do banco de desenvolvimento não vale aqui e é replicado abaixo.
 */
export async function createTestDatabase(cfg: TestDbConfig, options: { migrateUpTo?: string } = {}): Promise<void> {
  assertTestDatabaseName(cfg.database);
  const database = `"${cfg.database}"`;
  const owner = `"${cfg.ownerUser}"`;
  const app = `"${cfg.appUser}"`;

  const maintenance = await connect(cfg, { user: cfg.adminUser, password: cfg.adminPassword, database: 'postgres' });
  try {
    const appRole = await maintenance.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [cfg.appUser]);
    if (appRole.rowCount === 0) {
      throw new Error(
        `O role de runtime "${cfg.appUser}" não existe neste Postgres. Ele é criado pelo docker-compose ` +
          `do backend (docker/init-db/001-create-app-role.sql) na primeira subida do volume.`,
      );
    }
    await maintenance.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${cfg.ownerUser}') THEN
          CREATE ROLE ${owner} LOGIN PASSWORD '${cfg.ownerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$`);
    await dropDatabase(maintenance, cfg.database);
    await maintenance.query(`CREATE DATABASE ${database} OWNER ${owner}`);
    await maintenance.query(`GRANT CONNECT ON DATABASE ${database} TO ${app}`);
  } finally {
    await maintenance.end();
  }

  const inDatabase = await connect(cfg, { user: cfg.adminUser, password: cfg.adminPassword, database: cfg.database });
  try {
    // A InitialSchema faz CREATE EXTENSION; o dono sem superusuário não precisa (nem deve) fazê-lo.
    await inDatabase.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await inDatabase.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
    await inDatabase.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
    );
    await inDatabase.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
    );
  } finally {
    await inDatabase.end();
  }

  await runMigrations(cfg, options.migrateUpTo);
}

# SP1 · Etapa 1.1 — Harness de integração e testes de caracterização — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ter testes de integração rodando contra um Postgres real (banco `inventory_saas_test`, dono sem superusuário, role de runtime com RLS) e usá-los para provar três suspeitas do desenho mestre: RLS/conexão reutilizada (F18?), semântica de `updatedAt` (F5) e ordem resposta×commit do middleware (F16).

**Architecture:** Um segundo runner Jest (`jest.integration.config.js`, regex `.int-spec.ts`) com `globalSetup` que recria o banco de teste e roda as migrations reais como dono não superusuário. Helpers em `src/test-utils/` (config + trava de segurança, ciclo de vida do banco, conexões/`withTenant`/seeds). Os testes de caracterização ficam ao lado do código que exercitam. A única mudança de produção é a correção do F16 em `TenantContextMiddleware` (a transação termina **antes** de a resposta sair).

**Tech Stack:** NestJS 10, TypeORM 0.3, `pg` 8.23, Jest 29 + ts-jest 29, Express 4.22, dotenv 17, Postgres 16 (container `backend-postgres-1`, porta do host 5433).

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md) (seção 3, "Etapa 1.1"). Contexto maior: [desenho mestre](../specs/2026-09-20-cadastros-2-0-design-mestre.md).

## Global Constraints

Copiadas do spec (valem para todas as tarefas):

- `jest.integration.config.js`: `testRegex: '.*\\.int-spec\\.ts$'`, `maxWorkers: 1`, `globalSetup` próprio. O `jest.config.js` atual (`.*\\.spec\\.ts$`) **não** casa com `x.int-spec.ts`, então `npm test` continua rápido e sem Docker.
- Scripts: `npm run test:int`.
- **Trava de segurança:** o harness aborta se o nome do banco não terminar em `_test`, e **nunca** lê `DB_NAME` do `.env` para escolher onde escrever. Só usa host/porta/credenciais do `.env`.
- Migrations rodam no teste como dono do banco **sem ser superusuário** (`FORCE ROW LEVEL SECURITY` vale para o dono, como em bancos gerenciados).
- Mensagem clara quando o Postgres não responde ("suba `docker compose up -d postgres`").
- O banco de desenvolvimento `inventory_saas` **não** é tocado. Migrations só são aplicadas nele com autorização explícita do usuário (não faz parte desta etapa).
- Pronto quando: `npm run test:int` roda do zero (cria banco, migra, testa), `npm test` segue verde com os 94 testes originais, e os testes de caracterização estão escritos com o resultado documentado.

Restrições da sessão (também valem):

- **Não commitar sem pedido explícito do usuário.** Os passos "Commit" abaixo só se executam se o usuário já tiver autorizado commits; senão, pule o passo. Ao commitar, faça `git add` **somente dos arquivos listados na tarefa** (a árvore tem mudanças não relacionadas de outras frentes — login/branding, app mobile).
- Todos os comandos rodam a partir de `C:\PROJETOS\SAAS\backend` (`cd /c/PROJETOS/SAAS/backend` no Git Bash).
- Baselines medidas em 2026-09-20: `npm test` = 15 suítes / 94 testes verdes; `npx tsc --noEmit -p tsconfig.json` = exit 0.
- Pré-requisito de ambiente: `docker ps` deve listar `backend-postgres-1` como `healthy`. Se não estiver: `docker compose up -d postgres` dentro de `backend/`.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/jest.integration.config.js` | criar | Runner dos testes de integração |
| `backend/package.json` | modificar | Script `test:int` |
| `backend/src/test-utils/test-db-config.ts` | criar | Config do banco de teste + trava `_test` (puro, sem I/O) |
| `backend/src/test-utils/test-db-config.spec.ts` | criar | Testes unitários da trava (rodam no `npm test`, sem Docker) |
| `backend/src/test-utils/test-db-lifecycle.ts` | criar | Criar/recriar/apagar banco de teste, carregar e rodar migrations (até um ponto), `queryAsAdmin`/`queryAsOwner` |
| `backend/src/test-utils/test-db-lifecycle.int-spec.ts` | criar | Prova: migração em etapas + ambiente fiel ao real |
| `backend/src/test-utils/global-setup.ts` | criar | Recria `inventory_saas_test` uma vez por execução |
| `backend/src/test-utils/test-db.ts` | criar | Runtime dos testes: `appDataSource`, `withTenant`, seeds, `truncateAll` |
| `backend/src/database/rls-isolation.int-spec.ts` | criar | Caracterização de RLS (isolamento, FORCE, conexão reutilizada) |
| `backend/src/database/updated-at-semantics.int-spec.ts` | criar | Caracterização F5 |
| `backend/src/common/tenant/tenant-context.middleware.int-spec.ts` | criar | Caracterização + regressão F16 |
| `backend/src/common/tenant/tenant-context.middleware.ts` | modificar | Correção F16 |
| `backend/README.md` | modificar | Seção "Testes" |
| `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` | modificar | Registrar resultados (F5, F16, F18) |
| `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` | modificar | Atualizar F16 e, se confirmado, acrescentar F18; seção 10 |

---

### Task 1: Runner de integração, trava de segurança e ciclo de vida do banco de teste

**Files:**
- Create: `backend/jest.integration.config.js`
- Modify: `backend/package.json` (scripts)
- Create: `backend/src/test-utils/test-db-config.ts`
- Test: `backend/src/test-utils/test-db-config.spec.ts`
- Create: `backend/src/test-utils/test-db-lifecycle.ts`
- Create: `backend/src/test-utils/global-setup.ts`
- Test: `backend/src/test-utils/test-db-lifecycle.int-spec.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa). Usa `backend/.env` apenas para host/porta/credenciais.
- Produces (usados pelas Tasks 2–4):
  - `test-db-config.ts`: `DEFAULT_TEST_DB_NAME = 'inventory_saas_test'`, `TEST_OWNER_ROLE = 'inventory_saas_test_owner'`, `TEST_OWNER_PASSWORD`, `interface TestDbConfig { host: string; port: number; adminUser: string; adminPassword: string; ownerUser: string; ownerPassword: string; appUser: string; appPassword: string; database: string }`, `assertTestDatabaseName(name: string): void`, `getTestDbConfig(database?: string, env?: NodeJS.ProcessEnv): TestDbConfig`.
  - `test-db-lifecycle.ts`: `loadMigrationClasses(upTo?: string): Function[]`, `createTestDatabase(cfg: TestDbConfig, options?: { migrateUpTo?: string }): Promise<void>`, `runMigrations(cfg: TestDbConfig, upTo?: string): Promise<void>`, `dropTestDatabase(cfg: TestDbConfig): Promise<void>`, `queryAsAdmin(cfg: TestDbConfig, sql: string, params?: unknown[]): Promise<any[]>`, `queryAsOwner(cfg: TestDbConfig, sql: string, params?: unknown[]): Promise<any[]>`.
  - `global-setup.ts`: `export default async function globalSetup(): Promise<void>`.

- [ ] **Step 1: Confirmar o ambiente**

Run: `docker ps --format '{{.Names}} {{.Status}}' | grep postgres`
Expected: uma linha `backend-postgres-1 Up … (healthy)`. Se não houver, `docker compose up -d postgres` em `backend/` e repita até `healthy`.

- [ ] **Step 2: Escrever o teste unitário da trava (vai falhar)**

Create `backend/src/test-utils/test-db-config.spec.ts`:

```ts
import { assertTestDatabaseName, DEFAULT_TEST_DB_NAME, getTestDbConfig } from './test-db-config';

const ENV = {
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_ADMIN_USER: 'postgres',
  DB_ADMIN_PASSWORD: 'admin-pw',
  DB_APP_USER: 'inventory_saas_app',
  DB_APP_PASSWORD: 'app-pw',
  DB_NAME: 'inventory_saas',
} as NodeJS.ProcessEnv;

describe('trava de segurança do banco de testes', () => {
  it('recusa o banco de desenvolvimento e qualquer nome sem o sufixo _test', () => {
    expect(() => assertTestDatabaseName('inventory_saas')).toThrow(/_test/);
    expect(() => assertTestDatabaseName('postgres')).toThrow(/_test/);
  });

  it('aceita nomes de banco de teste válidos', () => {
    expect(() => assertTestDatabaseName('inventory_saas_test')).not.toThrow();
    expect(() => assertTestDatabaseName('inventory_saas_harness_test')).not.toThrow();
  });

  it('recusa nomes com caracteres que permitiriam injeção em SQL', () => {
    for (const name of ['inventory_saas_test; DROP DATABASE x', 'Inventory_test', 'a"b_test', 'a b_test', '_test']) {
      expect(() => assertTestDatabaseName(name)).toThrow();
    }
  });
});

describe('getTestDbConfig', () => {
  it('usa o banco de testes padrão e IGNORA DB_NAME do ambiente', () => {
    const cfg = getTestDbConfig(undefined, ENV);
    expect(cfg.database).toBe(DEFAULT_TEST_DB_NAME);
    expect(cfg.database).not.toBe(ENV.DB_NAME);
  });

  it('lê host, porta e credenciais do ambiente', () => {
    const cfg = getTestDbConfig(undefined, ENV);
    expect(cfg).toMatchObject({
      host: 'localhost',
      port: 5433,
      adminUser: 'postgres',
      adminPassword: 'admin-pw',
      appUser: 'inventory_saas_app',
      appPassword: 'app-pw',
    });
  });

  it('recusa apontar para um banco que não seja de teste', () => {
    expect(() => getTestDbConfig('inventory_saas', ENV)).toThrow(/_test/);
  });

  it('explica qual variável de ambiente está faltando', () => {
    expect(() => getTestDbConfig(undefined, { ...ENV, DB_ADMIN_PASSWORD: '' })).toThrow(/DB_ADMIN_PASSWORD/);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/test-utils/test-db-config.spec.ts`
Expected: FAIL — `Cannot find module './test-db-config'`.

- [ ] **Step 4: Implementar a config e a trava**

Create `backend/src/test-utils/test-db-config.ts`:

```ts
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Só host, porta e credenciais vêm do .env. O NOME do banco de teste NUNCA vem
// de DB_NAME: é a trava que impede os testes de escreverem no banco de desenvolvimento.
dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });

export const DEFAULT_TEST_DB_NAME = 'inventory_saas_test';

// Role criado só para os testes, no Postgres local de Docker. Sem superusuário e sem
// BYPASSRLS, para que FORCE ROW LEVEL SECURITY valha para ele como em bancos gerenciados.
// A senha fixa é intencional: o role só existe no ambiente local de desenvolvimento.
export const TEST_OWNER_ROLE = 'inventory_saas_test_owner';
export const TEST_OWNER_PASSWORD = 'test_owner_local_only';

export interface TestDbConfig {
  host: string;
  port: number;
  adminUser: string; // superusuário: só cria/apaga bancos e semeia dados (ignora RLS)
  adminPassword: string;
  ownerUser: string; // dono do banco de teste: roda as migrations
  ownerPassword: string;
  appUser: string; // role de RUNTIME da aplicação: é nele que a RLS realmente vale
  appPassword: string;
  database: string;
}

// O nome vai interpolado em SQL (CREATE/DROP DATABASE não aceitam parâmetro),
// então o formato é estrito: minúsculas, dígitos e "_", terminando em "_test".
export function assertTestDatabaseName(name: string): void {
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Recusado: "${name}" não é um banco de testes. O nome precisa ser minúsculo, ` +
        `usar só letras/dígitos/"_" e terminar em "_test" (ex.: ${DEFAULT_TEST_DB_NAME}).`,
    );
  }
}

export function getTestDbConfig(
  database: string = DEFAULT_TEST_DB_NAME,
  env: NodeJS.ProcessEnv = process.env,
): TestDbConfig {
  assertTestDatabaseName(database);

  for (const key of ['DB_ADMIN_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD']) {
    if (!env[key]) {
      throw new Error(`Variável ${key} ausente no backend/.env (necessária para os testes de integração).`);
    }
  }

  return {
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || '5432', 10),
    adminUser: env.DB_ADMIN_USER || 'postgres',
    adminPassword: env.DB_ADMIN_PASSWORD!,
    ownerUser: TEST_OWNER_ROLE,
    ownerPassword: TEST_OWNER_PASSWORD,
    appUser: env.DB_APP_USER!,
    appPassword: env.DB_APP_PASSWORD!,
    database,
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/test-utils/test-db-config.spec.ts`
Expected: PASS — 7 testes.

- [ ] **Step 6: Criar o runner de integração e o script**

Create `backend/jest.integration.config.js`:

```js
/**
 * Testes de integração contra Postgres real (RLS, triggers, migrations, middleware).
 * Rodam com `npm run test:int` — ver backend/README.md, seção "Testes".
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // "-spec" com hífen de propósito: o jest.config.js (unitário) só casa ".spec.ts",
  // então `npm test` continua rápido e sem Docker.
  testRegex: '.*\\.int-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  // Um único banco compartilhado: os arquivos rodam em sequência.
  maxWorkers: 1,
  testTimeout: 60000,
  globalSetup: '<rootDir>/test-utils/global-setup.ts',
};
```

Modify `backend/package.json` — no bloco `"scripts"`, logo abaixo de `"test:watch": "jest --watch"`:

```json
    "test": "jest",
    "test:watch": "jest --watch",
    "test:int": "jest --config jest.integration.config.js"
```

(acrescente a vírgula depois de `"test:watch": "jest --watch"` e mantenha o restante do arquivo intacto).

- [ ] **Step 7: Escrever o teste de integração do ciclo de vida (vai falhar)**

Create `backend/src/test-utils/test-db-lifecycle.int-spec.ts`:

```ts
import { getTestDbConfig, TEST_OWNER_ROLE } from './test-db-config';
import { createTestDatabase, dropTestDatabase, queryAsAdmin, runMigrations } from './test-db-lifecycle';

// Banco PRÓPRIO deste arquivo: "inventory_saas_test" pertence ao globalSetup e aos demais testes.
const cfg = getTestDbConfig('inventory_saas_harness_test');

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await queryAsAdmin(
    cfg,
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length === 1;
}

describe('harness — banco de teste, migrations em etapas e privilégios', () => {
  afterAll(() => dropTestDatabase(cfg));

  it('migra só até o ponto pedido e depois aplica o restante', async () => {
    await createTestDatabase(cfg, { migrateUpTo: '1700000004000' });
    expect(await hasColumn('losses', 'reasonId')).toBe(true); // migration 4000 já rodou
    expect(await hasColumn('companies', 'lossVerificationEnabled')).toBe(false); // 9000 ainda não

    await runMigrations(cfg);
    expect(await hasColumn('companies', 'lossVerificationEnabled')).toBe(true);
  });

  it('reproduz o ambiente real: dono sem superusuário, FORCE RLS e privilégios do role de runtime', async () => {
    await createTestDatabase(cfg);

    const [table] = await queryAsAdmin(
      cfg,
      `SELECT t.tableowner AS owner, c.relforcerowsecurity AS forced
         FROM pg_tables t JOIN pg_class c ON c.oid = ('public.' || t.tablename)::regclass
        WHERE t.schemaname = 'public' AND t.tablename = 'products'`,
    );
    expect(table.owner).toBe(TEST_OWNER_ROLE);
    expect(table.forced).toBe(true);

    const [privileges] = await queryAsAdmin(
      cfg,
      `SELECT has_table_privilege($1, 'public.products', 'SELECT')   AS "select",
              has_table_privilege($1, 'public.products', 'INSERT')   AS "insert",
              has_table_privilege($1, 'public.products', 'UPDATE')   AS "update",
              has_table_privilege($1, 'public.products', 'DELETE')   AS "delete",
              has_table_privilege($1, 'public.products', 'TRUNCATE') AS "truncate"`,
      [cfg.appUser],
    );
    expect(privileges).toEqual({ select: true, insert: true, update: true, delete: true, truncate: false });
  });
});
```

- [ ] **Step 8: Rodar e ver falhar**

Run: `npm run test:int`
Expected: FAIL — o `globalSetup` não existe ainda (`Cannot find module '…/test-utils/global-setup.ts'`). Esse erro confirma que o runner está ligado.

- [ ] **Step 9: Implementar o ciclo de vida do banco**

Create `backend/src/test-utils/test-db-lifecycle.ts`:

```ts
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
```

Create `backend/src/test-utils/global-setup.ts`:

```ts
import { getTestDbConfig } from './test-db-config';
import { createTestDatabase } from './test-db-lifecycle';

/** Recria o banco de testes uma vez por execução do `npm run test:int`. */
export default async function globalSetup(): Promise<void> {
  await createTestDatabase(getTestDbConfig());
}
```

- [ ] **Step 10: Rodar e ver passar**

Run: `npm run test:int`
Expected: PASS — `test-db-lifecycle.int-spec.ts` com 2 testes; o `globalSetup` cria `inventory_saas_test` e aplica as 10 migrations reais como dono sem superusuário. Se uma migration antiga falhar como dono sem superusuário, **pare** e reporte a migration e a mensagem de erro ao usuário (não altere migrations já aplicadas em produção).

- [ ] **Step 11: Garantir que o `npm test` continua sem Docker e verde**

Run: `npm test`
Expected: PASS — 16 suítes, 101 testes (94 originais + 7 novos). O arquivo `.int-spec.ts` **não** aparece na lista.

- [ ] **Step 12: Commit (somente se o usuário já autorizou commits)**

```bash
git add backend/jest.integration.config.js backend/package.json backend/src/test-utils
git commit -m "test(backend): harness de integração com Postgres real e trava de banco de teste" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Runtime de testes (`withTenant`, seeds) e caracterização de RLS

**Files:**
- Create: `backend/src/test-utils/test-db.ts`
- Test: `backend/src/database/rls-isolation.int-spec.ts`

**Interfaces:**
- Consumes (Task 1): `getTestDbConfig`, `TestDbConfig` de `./test-db-config`; `queryAsAdmin`, `queryAsOwner` de `./test-db-lifecycle`.
- Produces (usados pelas Tasks 3–4 e pelas etapas 1.2–1.4):
  - `TEST_ENTITIES: Function[]`
  - `testDbConfig(): TestDbConfig` (banco `inventory_saas_test`)
  - `appDataSource(): Promise<DataSource>` — conexão do role de runtime (RLS ativa), reaproveitada no arquivo de teste
  - `adminQuery(sql: string, params?: unknown[]): Promise<any[]>` — superusuário, ignora RLS
  - `ownerQuery(sql: string, params?: unknown[]): Promise<any[]>` — dono sem superusuário
  - `withTenant<T>(ctx: { companyId: string; userId?: string; role?: UserRole }, fn: (manager: EntityManager) => Promise<T>): Promise<T>` — mesma mecânica do `TenantContextMiddleware` (transação + `set_config` + `tenantStorage`)
  - `seedCompany(name: string): Promise<string>` (id)
  - `seedProduct(input: { companyId: string; barcode: string; name?: string; unitPrice?: number; costPrice?: number }): Promise<string>` (id)
  - `truncateAll(): Promise<void>`
  - `closeTestConnections(): Promise<void>` — chamar no `afterAll` de todo arquivo que use `appDataSource`

- [ ] **Step 1: Escrever os testes de RLS (vão falhar)**

Create `backend/src/database/rls-isolation.int-spec.ts`:

```ts
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

  it('conexão reutilizada: sem contexto de tenant o role de runtime não recebe erro nem linhas', async () => {
    const companyId = await seedCompany('Empresa Conexão');
    await seedProduct({ companyId, barcode: '4444' });

    // Mesma conexão física nas duas transações — como um pool devolvendo a conexão
    // depois de uma requisição de tenant e entregando-a a uma requisição sem tenant
    // (ex.: master_admin, que não define app.current_company_id).
    const queryRunner = (await appDataSource()).createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction();
      await queryRunner.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]);
      await queryRunner.commitTransaction();

      await queryRunner.startTransaction();
      const rows = await queryRunner.query('SELECT id FROM products');
      await queryRunner.commitTransaction();

      expect(rows).toEqual([]);
    } catch (error) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
      throw error;
    } finally {
      await queryRunner.release();
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest --config jest.integration.config.js src/database/rls-isolation.int-spec.ts`
Expected: FAIL — `Cannot find module '../test-utils/test-db'`.

- [ ] **Step 3: Implementar o runtime de testes**

Create `backend/src/test-utils/test-db.ts`:

```ts
import { DataSource, EntityManager } from 'typeorm';
import { tenantStorage } from '../common/tenant/tenant-storage';
import { Company } from '../modules/companies/company.entity';
import { CompanyMonthlyRevenue } from '../modules/company-revenue/company-monthly-revenue.entity';
import { ImportJob } from '../modules/imports/import-job.entity';
import { LossLocation } from '../modules/loss-locations/loss-location.entity';
import { LossReason } from '../modules/loss-reasons/loss-reason.entity';
import { Loss } from '../modules/losses/loss.entity';
import { Product } from '../modules/products/product.entity';
import { User, UserRole } from '../modules/users/user.entity';
import { getTestDbConfig, TestDbConfig } from './test-db-config';
import { queryAsAdmin, queryAsOwner } from './test-db-lifecycle';

// Mesma lista de entidades registrada em app.module.ts (a de data-source.ts está defasada).
export const TEST_ENTITIES = [Company, User, Product, Loss, ImportJob, LossReason, LossLocation, CompanyMonthlyRevenue];

let cachedConfig: TestDbConfig | undefined;

/** Config do banco de testes compartilhado (`inventory_saas_test`, criado pelo globalSetup). */
export function testDbConfig(): TestDbConfig {
  cachedConfig ??= getTestDbConfig();
  return cachedConfig;
}

let cachedAppDataSource: DataSource | undefined;

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
      entities: TEST_ENTITIES,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    cachedAppDataSource = dataSource;
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
  if (cachedAppDataSource?.isInitialized) await cachedAppDataSource.destroy();
  cachedAppDataSource = undefined;
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
```

- [ ] **Step 4: Rodar e registrar o resultado**

Run: `npm run test:int -- src/database/rls-isolation.int-spec.ts`
Expected: os três primeiros testes **PASSAM**. O quarto (conexão reutilizada) tem dois desfechos possíveis — **registre qual ocorreu**:
- **PASS:** o Postgres devolve `NULL` em `current_setting(..., true)` após o reuso; nada a fazer.
- **FAIL** com `invalid input syntax for type uuid: ""`: o Postgres devolve **string vazia** (não `NULL`) numa conexão que já teve a variável definida, e o cast `''::uuid` das políticas de RLS estoura. Isso é um problema real e novo (**F18**): qualquer requisição sem tenant (ex.: `master_admin`) numa conexão reaproveitada do pool pode falhar. **Não corrija aqui** (envolve reescrever as políticas de todas as tabelas). Faça o Step 5.

- [ ] **Step 5 (somente se o quarto teste falhou): documentar o F18 como falha conhecida**

Em `backend/src/database/rls-isolation.int-spec.ts`, troque `it('conexão reutilizada:` por `it.failing('conexão reutilizada:` e acrescente este comentário logo acima do `it.failing`:

```ts
  // F18 (confirmado): numa conexão reaproveitada, current_setting('app.current_company_id', true)
  // devolve '' (não NULL) e o cast ''::uuid das políticas de RLS falha. Correção proposta (fora da
  // etapa 1.1, precisa de decisão): recriar as políticas com NULLIF(current_setting(...), '')::uuid.
  // Quando for corrigido, este teste passará a "falhar" como it.failing — troque para it().
```

Run: `npm run test:int -- src/database/rls-isolation.int-spec.ts`
Expected: PASS — 4 testes (o quarto, `failing`, conta como passado enquanto o bug existir).

- [ ] **Step 6: Commit (somente se autorizado)**

```bash
git add backend/src/test-utils/test-db.ts backend/src/database/rls-isolation.int-spec.ts
git commit -m "test(backend): withTenant, seeds e caracterização de RLS (conexão reutilizada)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Caracterização do F5 — `updatedAt` é o início da transação

**Files:**
- Test: `backend/src/database/updated-at-semantics.int-spec.ts`

**Interfaces:**
- Consumes (Task 2): `adminQuery`, `closeTestConnections`, `seedCompany`, `seedProduct`, `truncateAll`, `withTenant` de `../test-utils/test-db`; entidade `Product`.
- Produces: nenhuma API — o resultado do teste é a evidência que sustenta a janela de sobreposição de 2 min do sync (etapa 1.4).

- [ ] **Step 1: Escrever o teste**

Create `backend/src/database/updated-at-semantics.int-spec.ts`:

```ts
import { Product } from '../modules/products/product.entity';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

describe('semântica de updatedAt (F5 do desenho mestre)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('updatedAt é o INÍCIO da transação, não o momento da gravação', async () => {
    const companyId = await seedCompany('Empresa F5');
    const productId = await seedProduct({ companyId, barcode: '7890000000011', name: 'Arroz' });
    const [{ antes }] = await adminQuery(`SELECT "updatedAt" AS antes FROM products WHERE id = $1`, [productId]);

    await withTenant({ companyId }, async (manager) => {
      await manager.query('SELECT pg_sleep(1.1)'); // a transação já começou; a gravação vem depois
      const product = await manager.findOneOrFail(Product, { where: { id: productId } });
      product.name = 'Arroz Integral';
      await manager.save(product);
    });

    const [linha] = await adminQuery(
      `SELECT "updatedAt" > $2::timestamptz AS atualizado,
              EXTRACT(EPOCH FROM (clock_timestamp() - "updatedAt"))::float AS "idadeEmSegundos"
         FROM products WHERE id = $1`,
      [productId, antes],
    );

    expect(linha.atualizado).toBe(true); // a gravação de fato alterou updatedAt
    // Se updatedAt fosse o instante do UPDATE, a idade seria ~0. Sendo o início da
    // transação (1,1 s antes do commit), a idade é >= 1,1 s.
    expect(linha.idadeEmSegundos).toBeGreaterThanOrEqual(1.0);
  });
});
```

- [ ] **Step 2: Rodar**

Run: `npm run test:int -- src/database/updated-at-semantics.int-spec.ts`
Expected: PASS — 1 teste (leva ~1,5 s). Isso **confirma o F5**: `updatedAt` = início da transação, então uma linha alterada durante um sync pode ficar com `updatedAt` anterior ao cursor já gravado.

Se **FALHAR** em `idadeEmSegundos` (`Received: 0.0…`), a suposição do desenho estava errada (o TypeORM/Postgres marca o instante da gravação). **Pare**: não enfraqueça a asserção. Reporte ao usuário, porque isso muda o desenho do cursor (a sobreposição de 2 min deixaria de ser necessária para esse caso) e o F5 precisa ser reescrito no spec.

- [ ] **Step 3: Commit (somente se autorizado)**

```bash
git add backend/src/database/updated-at-semantics.int-spec.ts
git commit -m "test(backend): caracterização da semântica de updatedAt (F5)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: F16 — a resposta só sai depois do commit

**Files:**
- Test: `backend/src/common/tenant/tenant-context.middleware.int-spec.ts`
- Modify (substituir o arquivo inteiro): `backend/src/common/tenant/tenant-context.middleware.ts`

**Interfaces:**
- Consumes (Task 2): `adminQuery`, `appDataSource`, `closeTestConnections`, `seedCompany`, `truncateAll` de `../../test-utils/test-db`.
- Consumes (código existente): `getTenantContext`, `getTenantManager` de `./tenant-storage`; `TenantContextMiddleware(jwtService: JwtService, dataSource: DataSource)`, `JwtPayload`.
- Produces: `TenantContextMiddleware` com a mesma interface pública; nova garantia: **commit/rollback e liberação da conexão acontecem antes de a resposta ser entregue**; falha de commit ⇒ HTTP 500.

- [ ] **Step 1: Escrever os testes (vão falhar)**

Create `backend/src/common/tenant/tenant-context.middleware.int-spec.ts`:

```ts
import { JwtService } from '@nestjs/jwt';
import express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { UserRole } from '../../modules/users/user.entity';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { getTenantContext, getTenantManager } from './tenant-storage';

const JWT_SECRET = 'segredo-somente-de-teste';
const COMMIT_DELAY_MS = 300;

/** DataSource cujo commit demora: alarga a janela entre "resposta enviada" e "transação gravada". */
function withSlowCommit(dataSource: DataSource, delayMs: number): DataSource {
  return new Proxy(dataSource, {
    get(target, property) {
      if (property === 'createQueryRunner') {
        return (...args: Parameters<DataSource['createQueryRunner']>) => {
          const queryRunner = target.createQueryRunner(...args);
          const commit = queryRunner.commitTransaction.bind(queryRunner);
          queryRunner.commitTransaction = async () => {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            await commit();
          };
          return queryRunner;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** DataSource cujo commit sempre falha (a transação é desfeita, como no Postgres). */
function withFailingCommit(dataSource: DataSource): DataSource {
  return new Proxy(dataSource, {
    get(target, property) {
      if (property === 'createQueryRunner') {
        return (...args: Parameters<DataSource['createQueryRunner']>) => {
          const queryRunner = target.createQueryRunner(...args);
          const rollback = queryRunner.rollbackTransaction.bind(queryRunner);
          queryRunner.commitTransaction = async () => {
            await rollback();
            throw new Error('commit simulado falhou');
          };
          return queryRunner;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function insertProductAndRespond(res: express.Response, status: number, barcode: string): Promise<void> {
  try {
    const { companyId } = getTenantContext();
    await getTenantManager().query(
      `INSERT INTO products ("companyId", barcode, name) VALUES ($1, $2, 'Produto F16')`,
      [companyId, barcode],
    );
    res.status(status).json({ ok: status < 400 });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

async function startServer(dataSource: DataSource): Promise<TestServer> {
  const middleware = new TenantContextMiddleware(new JwtService({ secret: JWT_SECRET }), dataSource);
  const app = express();
  app.use((req, res, next) => {
    void middleware.use(req, res, next);
  });
  app.post('/created', (_req, res) => void insertProductAndRespond(res, 201, 'F16-COMMIT'));
  app.post('/conflict', (_req, res) => void insertProductAndRespond(res, 409, 'F16-ROLLBACK'));

  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Resolve quando o corpo da resposta terminou de chegar ao cliente. */
function post(baseUrl: string, path: string, token: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, (response) => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
    });
    request.on('error', reject);
    request.end();
  });
}

describe('TenantContextMiddleware — a resposta só sai depois do commit (F16)', () => {
  let token: string;

  beforeEach(async () => {
    await truncateAll();
    const companyId = await seedCompany('Empresa F16');
    token = await new JwtService({ secret: JWT_SECRET }).signAsync({
      sub: '00000000-0000-4000-8000-000000000001',
      role: UserRole.MANAGER,
      companyId,
    });
  });

  afterAll(() => closeTestConnections());

  describe('com commit lento', () => {
    let server: TestServer;
    beforeAll(async () => {
      server = await startServer(withSlowCommit(await appDataSource(), COMMIT_DELAY_MS));
    });
    afterAll(() => server.close());

    it('a linha gravada já está visível quando a resposta 2xx chega ao cliente', async () => {
      const { status } = await post(server.baseUrl, '/created', token);
      expect(status).toBe(201);

      // Lido por outra conexão (superusuário), no instante em que a resposta chegou.
      const rows = await adminQuery(`SELECT 1 FROM products WHERE barcode = 'F16-COMMIT'`);
      expect(rows).toHaveLength(1);
    });

    it('resposta de erro (409) desfaz a transação: nada é gravado', async () => {
      const { status } = await post(server.baseUrl, '/conflict', token);
      expect(status).toBe(409);

      await new Promise((resolve) => setTimeout(resolve, COMMIT_DELAY_MS + 200)); // qualquer commit tardio já teria ocorrido
      const rows = await adminQuery(`SELECT 1 FROM products WHERE barcode = 'F16-ROLLBACK'`);
      expect(rows).toHaveLength(0);
    });
  });

  describe('com commit que falha', () => {
    let server: TestServer;
    beforeAll(async () => {
      server = await startServer(withFailingCommit(await appDataSource()));
    });
    afterAll(() => server.close());

    it('o cliente recebe 500 (não um sucesso que não foi gravado) e nada é gravado', async () => {
      const { status } = await post(server.baseUrl, '/created', token);

      expect(status).toBe(500);
      const rows = await adminQuery(`SELECT 1 FROM products WHERE barcode = 'F16-COMMIT'`);
      expect(rows).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (F16 confirmado)**

Run: `npm run test:int -- src/common/tenant/tenant-context.middleware.int-spec.ts`
Expected: **2 falham, 1 passa**:
- `a linha gravada já está visível…` — FAIL (`Expected length: 1, Received length: 0`): a resposta chegou antes do commit.
- `resposta de erro (409) desfaz…` — PASS (guarda de regressão: o rollback já funciona).
- `o cliente recebe 500…` — FAIL (`Expected: 500, Received: 201`): a falha de commit é engolida (`.catch(() => undefined)`) e o cliente recebe sucesso de algo que não foi gravado.

Se o primeiro teste **passar** sem a correção, **pare** e reporte: o F16 não se confirma e o desenho precisa ser revisto (não implemente o Step 3).

- [ ] **Step 3: Corrigir o middleware**

Substitua **todo** o conteúdo de `backend/src/common/tenant/tenant-context.middleware.ts` por:

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { DataSource, QueryRunner } from 'typeorm';
import { tenantStorage } from './tenant-storage';
import { UserRole } from '../../modules/users/user.entity';

export interface JwtPayload {
  sub: string; // userId
  role: UserRole;
  companyId: string | null;
}

// Express aumentado para carregar o usuário autenticado nas rotas — usado pelos
// guards de papel (RolesGuard) e pelo decorator @CurrentUser().
declare module 'express' {
  interface Request {
    authUser?: JwtPayload;
  }
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    let payload: JwtPayload | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        payload = await this.jwtService.verifyAsync<JwtPayload>(authHeader.slice(7));
        req.authUser = payload;
      } catch {
        // Token ausente/inválido: segue sem usuário autenticado. Rotas protegidas
        // são barradas pelo JwtAuthGuard, que roda depois deste middleware.
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (payload?.companyId) {
        // set_config(..., true) com is_local=true: a variável só vale dentro
        // desta transação — a próxima requisição, em outra transação, começa limpa.
        await queryRunner.query(`SELECT set_config('app.current_company_id', $1, true)`, [
          payload.companyId,
        ]);
      }

      const context = {
        userId: payload?.sub ?? '',
        role: payload?.role ?? UserRole.EMPLOYEE,
        companyId: payload?.companyId ?? null,
        manager: queryRunner.manager,
      };

      this.finishTransactionBeforeResponse(res, queryRunner);

      tenantStorage.run(context, () => next());
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
      await queryRunner.release();
      next(err);
    }
  }

  /**
   * A resposta só é entregue DEPOIS de a transação terminar. Antes, o commit ficava em
   * `res.on('finish')` — que dispara depois de a resposta já ter saído — e o cliente
   * (ex.: o app, que sincroniza logo em seguida) podia ler antes do commit. Também
   * engolia falha de commit: o cliente recebia sucesso de algo que não foi gravado.
   *
   * Todo caminho de resposta do Express/Nest (json, send, download, stream com pipe)
   * termina em `res.end`, por isso é ali que a transação é finalizada.
   */
  private finishTransactionBeforeResponse(res: Response, queryRunner: QueryRunner): void {
    const originalEnd = res.end.bind(res) as unknown as (...args: unknown[]) => Response;
    let finalization: Promise<void> | null = null;

    res.end = ((...args: unknown[]) => {
      finalization ??= this.finishTransaction(queryRunner, res.statusCode >= 200 && res.statusCode < 400);
      finalization.then(
        () => {
          originalEnd(...args);
        },
        () => {
          // O commit falhou: o cliente não pode receber um sucesso que não foi gravado.
          if (res.headersSent) {
            originalEnd();
            return;
          }
          res.statusCode = 500;
          res.removeHeader('Content-Length');
          res.removeHeader('ETag');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          originalEnd(JSON.stringify({ statusCode: 500, message: 'Erro interno ao concluir a operação.' }));
        },
      );
      return res;
    }) as Response['end'];
  }

  private async finishTransaction(queryRunner: QueryRunner, commit: boolean): Promise<void> {
    try {
      if (commit) {
        await queryRunner.commitTransaction();
      } else {
        await queryRunner.rollbackTransaction();
      }
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction().catch(() => undefined);
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:int -- src/common/tenant/tenant-context.middleware.int-spec.ts`
Expected: PASS — 3 testes. O primeiro leva ~300 ms (a resposta agora espera o commit lento).

- [ ] **Step 5: Verificar que nada mais quebrou**

Run: `npm test && npm run test:int && npx tsc --noEmit -p tsconfig.json`
Expected: `npm test` → 16 suítes / 101 testes verdes; `npm run test:int` → 4 arquivos, todos verdes (10 testes: 2 + 4 + 1 + 3 — o do F18 conta como verde tanto se passou quanto se está `failing`); `tsc` → exit 0.

- [ ] **Step 6: Commit (somente se autorizado)**

```bash
git add backend/src/common/tenant/tenant-context.middleware.ts backend/src/common/tenant/tenant-context.middleware.int-spec.ts
git commit -m "fix(backend): a resposta só sai depois do commit e falha de commit vira 500 (F16)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Documentação, registro de resultados e verificação final

**Files:**
- Modify: `backend/README.md` (acrescentar ao final)
- Modify: `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` (seção 3)
- Modify: `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (tabela de falhas e seção 10)

**Interfaces:**
- Consumes: os resultados reais dos Steps 4 (Task 2), 2 (Task 3) e 2/4 (Task 4).
- Produces: documentação de como rodar `test:int` e o registro oficial de F5/F16/F18 para as etapas 1.2–1.4.

- [ ] **Step 1: Documentar os testes no README do backend**

Acrescente ao **final** de `backend/README.md`:

````markdown

## Testes

- `npm test` — testes **unitários** (rápidos, sem Docker; `manager` mockado).
- `npm run test:int` — testes de **integração** contra Postgres real (RLS, triggers, migrations, middleware). Requer o Postgres do compose: `docker compose up -d postgres` (porta do host no `.env`, hoje 5433).

Os testes de integração usam **somente** o banco `inventory_saas_test`, recriado do zero a cada execução (dono `inventory_saas_test_owner`, **sem** superusuário, para que `FORCE ROW LEVEL SECURITY` valha como em bancos gerenciados; o role de runtime `inventory_saas_app` é quem executa as consultas). O banco de desenvolvimento **nunca** é tocado: o harness recusa qualquer nome que não termine em `_test` e não lê `DB_NAME` do `.env`.

Convenções:

- Arquivos de integração terminam em `.int-spec.ts` (com hífen; `.spec.ts` é unitário).
- Helpers em `src/test-utils/`: `withTenant()` (mesma mecânica do `TenantContextMiddleware`), `seedCompany()`, `seedProduct()`, `truncateAll()`, `adminQuery()` (superusuário, ignora RLS) e `ownerQuery()`. Todo arquivo que usa `appDataSource()` deve chamar `closeTestConnections()` no `afterAll`.
- Para testar um backfill, crie um banco próprio (`createTestDatabase(cfg, { migrateUpTo })`, nome terminando em `_test`), semeie dados "legados" como superusuário e aplique o restante com `runMigrations(cfg)`. Ver `src/test-utils/test-db-lifecycle.int-spec.ts`.
````

- [ ] **Step 2: Registrar os resultados no spec do SP1**

No fim da seção **"3. Etapa 1.1"** de `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`, logo depois do parágrafo "**Pronto quando:** …", acrescente:

```markdown

**Resultados (etapa 1.1 executada em AAAA-MM-DD):**
- **F5 confirmado** — `updated-at-semantics.int-spec.ts`: `updatedAt` é o início da transação (idade ≥ 1,0 s após `pg_sleep(1.1)`). A sobreposição de 2 min do sync (etapa 1.4) está justificada.
- **F16 confirmado e corrigido** — `tenant-context.middleware.int-spec.ts`: com commit de 300 ms, a resposta chegava antes da gravação; e uma falha de commit era engolida (cliente recebia 201 sem dado gravado). `TenantContextMiddleware` agora finaliza a transação em `res.end`, antes de entregar a resposta; falha de commit vira 500; rollback em status ≥ 400 preservado.
- **F18** — ver linha seguinte (uma das duas):
  - *(se o teste passou)* **Descartado**: `current_setting(..., true)` devolve `NULL` em conexão reutilizada; as políticas de RLS estão seguras.
  - *(se o teste falhou)* **Confirmado**: em conexão reutilizada o Postgres devolve `''` e o cast `''::uuid` das políticas falha para requisições sem tenant (ex.: `master_admin`). Teste marcado `it.failing` em `rls-isolation.int-spec.ts`. **Decisão pendente do usuário:** recriar as políticas com `NULLIF(current_setting('app.current_company_id', true), '')::uuid` (uma migration nova; afeta `users`, `products`, `losses`, `loss_reasons`, `loss_locations`, `import_jobs`, `company_monthly_revenue` e as tabelas novas do SP1).
```

Substitua `AAAA-MM-DD` pela data de hoje e **apague a linha do desfecho que não ocorreu** (deixe só uma sub-linha de F18).

- [ ] **Step 3: Atualizar o desenho mestre**

Em `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md`:

1. Na tabela da seção 2, troque a linha do **F16** por:

```markdown
| F16 | **Confirmado e corrigido (SP1 etapa 1.1).** O commit da transação acontecia depois do evento `finish`, ou seja, depois de a resposta sair; falha de commit era engolida (cliente recebia sucesso sem gravação). | `tenant-context.middleware.ts` (antes: linhas 63-72) | Leitura após escrita inconsistente (app sincronizando logo após a resposta) e sucesso falso em falha de commit. | SP1 — feito |
```

2. **Somente se o F18 foi confirmado**, acrescente logo abaixo da linha do F17:

```markdown
| F18 | Numa conexão reaproveitada do pool, `current_setting('app.current_company_id', true)` devolve `''` (não `NULL`) e o cast `''::uuid` das políticas de RLS falha para requisições sem tenant (ex.: `master_admin`). | `rls-isolation.int-spec.ts` (teste `it.failing`); políticas em `1700000000000-InitialSchema.ts:124-140` e migrations seguintes | Requisições do `master_admin` podem falhar de forma intermitente, dependendo da conexão sorteada. | Decisão pendente (migration com `NULLIF`) |
```

3. Na tabela da seção 10, na linha do **SP1**, troque o status por: `Etapa 1.1 (harness + F5/F16/F18) **concluída**; etapa 1.2 é a próxima` e acrescente o link do plano `[plano 1.1](../plans/2026-09-20-sp1-etapa-1-1-harness-integracao.md)` na coluna "Plano".

- [ ] **Step 4: Verificação final (superpowers:verification-before-completion)**

Run, nesta ordem, e **cole a saída resumida** na resposta ao usuário:

```bash
cd /c/PROJETOS/SAAS/backend
npm test
npm run test:int
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git status --short backend docs | head -30
```

Expected:
- `npm test`: `Test Suites: 16 passed`, `Tests: 101 passed`.
- `npm run test:int`: 4 arquivos (`test-db-lifecycle`, `rls-isolation`, `updated-at-semantics`, `tenant-context.middleware`), 10 testes, todos verdes (o `globalSetup` recria o banco antes).
- `tsc exit=0`.
- `git status`: só os arquivos listados na tabela "Estrutura de arquivos" (nenhum arquivo de migration, nenhuma alteração em `data-source.ts`/`app.module.ts`).

Relate ao usuário o desfecho do F18 (passou ou falhou) e, se falhou, peça a decisão sobre a migration de `NULLIF`.

- [ ] **Step 5: Commit (somente se autorizado)**

```bash
git add backend/README.md docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md docs/superpowers/plans/2026-09-20-sp1-etapa-1-1-harness-integracao.md
git commit -m "docs(sp1): resultados da etapa 1.1 (F5, F16, F18) e como rodar test:int" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Auto-revisão (executada ao escrever o plano)

**Cobertura do spec (seção 3, "Etapa 1.1"):**
- `jest.integration.config.js` (regex, `maxWorkers: 1`, `globalSetup`) → Task 1, Steps 6/9.
- Script `npm run test:int` → Task 1, Step 6.
- `setupTestDatabase()` como `createTestDatabase` (banco recriado, dono `NOSUPERUSER`, `GRANT`/`ALTER DEFAULT PRIVILEGES` replicados, migrations como dono) → Task 1, Step 9.
- `migrateUpTo`/`migrateRemaining` → `createTestDatabase(..., { migrateUpTo })` + `runMigrations(cfg, upTo?)`; provado no Step 7.
- `adminQuery`, `appDataSource`, `withTenant`, fábricas, `truncateAll` → Task 2 (fábricas limitadas a `seedCompany`/`seedProduct`; `seedUser`/`seedLoss` entram na etapa 1.2, quando forem usados — YAGNI).
- Trava `_test` + nunca ler `DB_NAME` → Task 1, Steps 2–5 (testado).
- Mensagem clara com o Postgres fora do ar → `connect()` em `test-db-lifecycle.ts`.
- Testes de caracterização: F5 → Task 3; F16 → Task 4; RLS → Task 2 (mais o caso F18, descoberto na leitura do código).
- Correção condicional do F16 → Task 4 (Steps 2 e 3; o plano manda parar se o teste não falhar antes).
- "Pronto quando" → Task 5, Step 4.

**Varredura de placeholders:** os únicos trechos condicionais são os desfechos de F18 e a data do registro (Task 5, Step 2), com instruções explícitas de qual manter e o texto completo de ambos.

**Consistência de tipos:** `TestDbConfig`, `getTestDbConfig`, `createTestDatabase`, `runMigrations`, `dropTestDatabase`, `queryAsAdmin`, `queryAsOwner` (Task 1) são usados com as mesmas assinaturas nas Tasks 2–4; `withTenant`, `seedCompany`, `seedProduct`, `truncateAll`, `adminQuery`, `ownerQuery`, `appDataSource`, `closeTestConnections` (Task 2) idem nas Tasks 3–4. A contagem de testes (7 unitários novos ⇒ 101; 10 de integração em 4 arquivos) está coerente entre as Tasks 1, 4 e 5.

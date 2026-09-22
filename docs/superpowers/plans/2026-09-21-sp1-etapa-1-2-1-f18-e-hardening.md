# SP1 · Sub-etapa 1.2.1 — Correção do F18 e hardening do harness — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o F18 (as políticas de RLS falham numa conexão do pool reaproveitada sem contexto de
tenant) com uma migration, e fechar as lacunas do harness de testes de integração que a etapa 1.1 deixou
registradas como pré-requisito antes de a sub-etapa 1.2.2 criar tabelas novas.

**Architecture:** Uma migration nova (`1700000010000-RlsReusedConnectionFix`) reescreve as 7 políticas de
RLS existentes trocando `current_setting('app.current_company_id', true)` por
`NULLIF(current_setting('app.current_company_id', true), '')` antes do cast `::uuid`. O harness ganha um
módulo único de entidades (elimina a 3ª cópia divergente) e três reforços de teste que a etapa 1.1 já
tinha identificado como necessários (privilégios do dono/role de runtime, controle positivo do `WITH
CHECK`, cobertura de `getTenantManager()` dentro de `withTenant`, guarda de `queryWith` no lado certo).

**Tech Stack:** NestJS 10, TypeORM 0.3, `pg` 8.23, Jest 29 + ts-jest 29, Postgres 16 (container
`backend-postgres-1`, porta do host 5433).

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md)
(seção 4, "Sub-etapa 1.2.1"). Contexto maior: [desenho mestre](../specs/2026-09-20-cadastros-2-0-design-mestre.md).

## Global Constraints

Copiadas do spec e da decisão do usuário em 2026-09-21 (valem para todas as tarefas):

- A correção do F18 é a **primeira** peça da etapa 1.2 — antes de qualquer tabela nova, para que elas não
  herdem o mesmo bug se copiarem o molde de política atual.
- A migration reescreve **exatamente** estas 7 políticas (confirmado por grep em todas as migrations que
  definem política — não há nenhuma outra): `tenant_isolation_users` (com o ramo `… IS NULL`),
  `tenant_isolation_products`, `tenant_isolation_losses`, `tenant_isolation_import_jobs`,
  `tenant_isolation_loss_reasons`, `tenant_isolation_loss_locations`,
  `tenant_isolation_company_monthly_revenue`. Não cria tabela, não mexe em `GRANT`/`FORCE`.
- **Pronto quando** (do spec): o teste "conexão reutilizada" do F18 passa como `it()` normal (sem
  `it.failing`); as três cópias da lista de entidades (`app.module.ts`, `data-source.ts`,
  `test-utils/test-db.ts`) viram uma só; os testes de RLS não ficam mais verdes "pela razão errada"
  (privilégios do dono/role de runtime e controle positivo do `WITH CHECK` agora são exigidos, não
  supostos).
- Contagens de teste: trate os números abaixo como o que se espera **a partir do baseline verificado por
  você mesmo antes de cada tarefa** (rode `npm test` / `npm run test:int` primeiro) — se não baterem,
  recalcule a partir do baseline real e reporte a diferença; não ajuste a asserção do teste em si.
- Baseline no início deste plano (confirme antes da Task 1): backend `npm test` = **17 suítes / 106
  testes**; `npm run test:int` = **4 arquivos / 14 testes**; `tsc --noEmit` limpo.
- O banco de desenvolvimento `inventory_saas` **nunca** é tocado pelos testes — só `*_test`. Aplicar esta
  migration no banco de desenvolvimento (`npm run migration:run`) só acontece com autorização explícita
  do usuário, fora deste plano.
- **NUNCA** rodar `npm run test:int` concorrentemente com outra execução (o `globalSetup` recria o banco
  compartilhado `inventory_saas_test`).
- Commits: só se o usuário autorizar explicitamente antes da execução. Se não autorizado, não rode `git
  add`/`git commit` — implemente, teste e reporte; o controlador decide o commit depois.
- Todos os comandos rodam a partir de `C:\PROJETOS\SAAS\backend` (`cd /c/PROJETOS/SAAS/backend` no Git
  Bash). Pré-requisito: `docker ps` deve listar `backend-postgres-1` como `healthy` (senão `docker
  compose up -d postgres` dentro de `backend/`).

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/database/migrations/1700000010000-RlsReusedConnectionFix.ts` | criar | Corrige o F18 |
| `backend/src/database/rls-isolation.int-spec.ts` | modificar (Task 1, depois Task 3) | Un-skip do F18 + nova regressão de `users`; depois, controle positivo do `WITH CHECK` + cobertura de `getTenantManager()` |
| `backend/src/database/entities.ts` | criar | Única lista de entidades do TypeORM |
| `backend/src/database/entities.spec.ts` | criar | Prova que `app.module.ts`/`data-source.ts` usam a lista única |
| `backend/src/app.module.ts` | modificar | Usa `ENTITIES` em vez da lista duplicada |
| `backend/src/database/data-source.ts` | modificar | Usa `ENTITIES` em vez da lista duplicada (hoje defasada) |
| `backend/src/test-utils/test-db.ts` | modificar | Usa `ENTITIES` em vez de `TEST_ENTITIES` local |
| `backend/src/test-utils/test-db-lifecycle.ts` | modificar (Task 3) | `queryWith` exportado e assertando `credentials.database` |
| `backend/src/test-utils/test-db-lifecycle.spec.ts` | modificar (Task 3) | Regressão do guard de `queryWith` |
| `backend/src/test-utils/test-db-lifecycle.int-spec.ts` | modificar (Task 3) | Assere `rolsuper=false`/`rolbypassrls=false` do dono e do role de runtime |

---

### Task 1: Migration do F18 e caracterização corrigida

**Files:**
- Create: `backend/src/database/migrations/1700000010000-RlsReusedConnectionFix.ts`
- Modify: `backend/src/database/rls-isolation.int-spec.ts` (substituir o arquivo inteiro)

**Interfaces:**
- Consumes: nada de outra tarefa deste plano. Usa os helpers já existentes de
  `../test-utils/test-db` (`adminQuery`, `appDataSource`, `closeTestConnections`, `ownerQuery`,
  `seedCompany`, `seedProduct`, `truncateAll`, `withTenant`) e a entidade `Product`.
- Produces: a migration `RlsReusedConnectionFix1700000010000` (aplicada automaticamente pelo
  `globalSetup` do harness em toda execução de `npm run test:int` daqui em diante — nenhuma tarefa
  seguinte precisa importar nada desta migration). `rls-isolation.int-spec.ts` ganha o helper interno
  `onReusedConnection<T>(firstTransaction, secondTransaction): Promise<T>` (não exportado; só usado
  dentro deste arquivo — a Task 3 vai acrescentar `it`s no mesmo arquivo, mas não precisa deste helper).

- [ ] **Step 1: Confirmar o ambiente e o baseline**

Run: `docker ps --filter name=backend-postgres-1 --format '{{.Status}}'`
Expected: contém `healthy`. Se não, `docker compose up -d postgres` na pasta `backend/` e aguarde.

Run: `npm test 2>&1 | tail -6 && npm run test:int 2>&1 | tail -10`
Expected: `17 suítes / 106 testes` e `4 arquivos / 14 testes`, ambos verdes (anote o baseline real se
diferir — ver Global Constraints).

- [ ] **Step 2: Rodar o teste atual do F18 e confirmar o estado (RED esperado antes da correção)**

Run: `npm run test:int -- src/database/rls-isolation.int-spec.ts`
Expected: PASS (o `it.failing` conta como passado enquanto falha; o teste irmão comprova a mensagem de
erro exata). Isto é só uma checagem de sanidade antes de mexer no arquivo — não precisa "falhar" ainda.

- [ ] **Step 3: Criar a migration**

Create `backend/src/database/migrations/1700000010000-RlsReusedConnectionFix.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

// Tabelas com a política padrão "tenant_isolation_<tabela>" (companyId = ...). "users" é tratada à
// parte logo abaixo, porque tem uma segunda condição para as linhas de MASTER_ADMIN (companyId NULL).
const STANDARD_TABLES = [
  'products',
  'losses',
  'import_jobs',
  'loss_reasons',
  'loss_locations',
  'company_monthly_revenue',
];

/**
 * Corrige o F18 (descoberto na etapa 1.1 — ver rls-isolation.int-spec.ts, teste "conexão reutilizada"):
 * numa conexão do pool que já serviu uma requisição de tenant, current_setting('app.current_company_id',
 * true) passa a devolver '' (texto vazio) em vez de NULL nas transações seguintes que não definem a
 * variável — uma GUC personalizada, uma vez registrada nessa conexão via set_config, nunca mais volta a
 * "não existir"; ela só volta ao valor padrão, que é '', não NULL. O cast ''::uuid das políticas
 * originais lança "invalid input syntax for type uuid" para toda requisição sem tenant (ex.:
 * master_admin) que caia numa conexão reaproveitada, em vez de simplesmente não enxergar nenhuma linha,
 * como pretendido.
 *
 * Correção: NULLIF(current_setting(...), '') normaliza '' para NULL ANTES do cast — daí em diante o
 * comportamento passa a ser idêntico ao de uma conexão nova (current_setting nunca definido).
 */
export class RlsReusedConnectionFix1700000010000 implements MigrationInterface {
  name = 'RlsReusedConnectionFix1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of STANDARD_TABLES) {
      await queryRunner.query(`DROP POLICY "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING ("companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
        WITH CHECK ("companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
      `);
    }

    // users: o ramo "... IS NULL" também precisa do NULLIF, senão '' (não NULL) faz "'' IS NULL" ser
    // falso e as linhas de MASTER_ADMIN (companyId NULL) ficariam invisíveis numa conexão reaproveitada,
    // em vez de continuarem visíveis só para sessões sem tenant (o comportamento pretendido).
    await queryRunner.query(`DROP POLICY "tenant_isolation_users" ON "users"`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_users" ON "users"
      USING (
        "companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        OR ("companyId" IS NULL AND NULLIF(current_setting('app.current_company_id', true), '') IS NULL)
      )
      WITH CHECK (
        "companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        OR ("companyId" IS NULL AND NULLIF(current_setting('app.current_company_id', true), '') IS NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Melhor esforço: restaura a expressão original (com o bug do F18), mesmo padrão já usado no
    // down() de outras migrations deste projeto — down() existe para desenvolvimento, não para produção.
    for (const table of STANDARD_TABLES) {
      await queryRunner.query(`DROP POLICY "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING ("companyId" = current_setting('app.current_company_id', true)::uuid)
        WITH CHECK ("companyId" = current_setting('app.current_company_id', true)::uuid)
      `);
    }

    await queryRunner.query(`DROP POLICY "tenant_isolation_users" ON "users"`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_users" ON "users"
      USING (
        "companyId" = current_setting('app.current_company_id', true)::uuid
        OR ("companyId" IS NULL AND current_setting('app.current_company_id', true) IS NULL)
      )
      WITH CHECK (
        "companyId" = current_setting('app.current_company_id', true)::uuid
        OR ("companyId" IS NULL AND current_setting('app.current_company_id', true) IS NULL)
      )
    `);
  }
}
```

- [ ] **Step 4: Substituir `rls-isolation.int-spec.ts` inteiro (un-skip + nova regressão)**

Replace the entire content of `backend/src/database/rls-isolation.int-spec.ts` with:

```ts
import { QueryRunner } from 'typeorm';
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
```

- [ ] **Step 5: Rodar SEM a migration aplicada ainda e confirmar RED (a migration só existe no arquivo, o `globalSetup` já rodou antes)**

Run: `npm run test:int -- src/database/rls-isolation.int-spec.ts`
Expected: FAIL — o teste "conexão reutilizada: sem contexto..." falha com `QueryFailedError: invalid
input syntax for type uuid: ""` (a migration ainda não foi aplicada ao banco compartilhado
`inventory_saas_test`, que só é recriado pelo `globalSetup` no INÍCIO da execução de `npm run test:int`
— como a migration é nova, ela só entra na próxima recriação). Isto confirma o RED.

Se o teste passar aqui, PARE e reporte BLOCKED — algo no ambiente já tem a correção ou o `globalSetup`
recriou o banco de um jeito inesperado; não prossiga sem entender por quê.

- [ ] **Step 6: Rodar de novo (o `globalSetup` recria o banco a cada execução de `npm run test:int`, agora já pega a migration nova) e ver GREEN**

Run: `npm run test:int`
Expected: PASS — todos os arquivos verdes, incluindo `rls-isolation.int-spec.ts` com os 6 testes
(nenhum `it.failing`, todos `it()` normais). Confira em especial:
- "conexão reutilizada: sem contexto..." passa de verdade (não é mais `it.failing`).
- "conexão reutilizada: linhas de master_admin..." passa.
- O total de arquivos/testes de integração bate com o baseline do Step 1 (14 → ainda 14: removeu 1
  teste irmão do F18, acrescentou 1 teste novo de `users`).

- [ ] **Step 7: Checagem final da tarefa**

Run: `npm test 2>&1 | tail -6 && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Expected: unitários inalterados (mesmo baseline do Step 1); `tsc exit=0`.

- [ ] **Step 8: Commit (somente se o usuário já autorizou commits nesta sessão)**

```bash
git add backend/src/database/migrations/1700000010000-RlsReusedConnectionFix.ts backend/src/database/rls-isolation.int-spec.ts
git commit -m "fix(backend): corrige RLS em conexão reaproveitada do pool (F18)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Módulo único de entidades

**Files:**
- Create: `backend/src/database/entities.ts`
- Create: `backend/src/database/entities.spec.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/database/data-source.ts`
- Modify: `backend/src/test-utils/test-db.ts`

**Interfaces:**
- Consumes: nada de outra tarefa deste plano (arquivos distintos dos da Task 1).
- Produces: `export const ENTITIES` (tipo `Function[]`, inferido) em `backend/src/database/entities.ts`,
  contendo `[Company, User, Product, Loss, ImportJob, LossReason, LossLocation, CompanyMonthlyRevenue]`
  nesta ordem — importado por `app.module.ts`, `data-source.ts` e `test-utils/test-db.ts`. Nenhuma
  tarefa seguinte deste plano depende disto, mas a sub-etapa 1.2.2 (fora deste plano) vai precisar
  acrescentar `ProductPriceHistory` a este array quando criar a tabela nova.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Create `backend/src/database/entities.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { dataSourceOptions } from './data-source';
import { ENTITIES } from './entities';

describe('módulo único de entidades (ENTITIES)', () => {
  it('tem exatamente as 8 entidades registradas hoje, sem duplicatas', () => {
    expect(ENTITIES).toHaveLength(8);
    expect(new Set(ENTITIES).size).toBe(8);
  });

  it('data-source.ts usa a MESMA referência de ENTITIES (não uma cópia)', () => {
    expect(dataSourceOptions.entities).toBe(ENTITIES);
  });

  it('app.module.ts importa ENTITIES de ./database/entities, sem lista duplicada', () => {
    const source = readFileSync(join(__dirname, '..', 'app.module.ts'), 'utf-8');
    expect(source).toContain("import { ENTITIES } from './database/entities';");
    expect(source).toContain('entities: ENTITIES,');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/database/entities.spec.ts`
Expected: FAIL — `Cannot find module './data-source'` ou `'./entities'` (nenhum dos dois arquivos foi
tocado ainda; `data-source.ts` já existe mas não exporta nada de `./entities`, então o import de
`ENTITIES` falha primeiro).

- [ ] **Step 3: Criar o módulo de entidades**

Create `backend/src/database/entities.ts`:

```ts
import { Company } from '../modules/companies/company.entity';
import { CompanyMonthlyRevenue } from '../modules/company-revenue/company-monthly-revenue.entity';
import { ImportJob } from '../modules/imports/import-job.entity';
import { Loss } from '../modules/losses/loss.entity';
import { LossLocation } from '../modules/loss-locations/loss-location.entity';
import { LossReason } from '../modules/loss-reasons/loss-reason.entity';
import { Product } from '../modules/products/product.entity';
import { User } from '../modules/users/user.entity';

/**
 * Única lista de entidades do TypeORM, importada por app.module.ts (conexão de runtime),
 * data-source.ts (CLI de migrations) e pelo harness de testes de integração
 * (test-utils/test-db.ts). Antes desta etapa havia 3 cópias manuais; data-source.ts já tinha
 * ficado defasada (faltava CompanyMonthlyRevenue) — ver "Pendências" da etapa 1.1 no spec do SP1.
 * Ao criar uma entidade nova (ex.: ProductPriceHistory na sub-etapa 1.2.2), acrescente aqui.
 */
export const ENTITIES = [
  Company,
  User,
  Product,
  Loss,
  ImportJob,
  LossReason,
  LossLocation,
  CompanyMonthlyRevenue,
];
```

- [ ] **Step 4: Rodar e ver falhar de novo, por outro motivo**

Run: `npx jest src/database/entities.spec.ts`
Expected: 1 passa (a de "8 entidades, sem duplicatas"); as outras 2 falham — `data-source.ts` ainda
exporta a lista duplicada (não é a mesma referência) e `app.module.ts` ainda não importa `ENTITIES`.

- [ ] **Step 5: Editar `data-source.ts`**

Modify `backend/src/database/data-source.ts` — substitua os imports de entidades individuais pelo
import do módulo único, e o array inline por `ENTITIES`:

```ts
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';

dotenv.config();

// Usado pela CLI do TypeORM (migration:run / migration:generate). Conecta com o
// role ADMINISTRADOR (dono das tabelas) porque criar/alterar tabelas e políticas
// de RLS exige privilégios que o role de runtime da aplicação (DB_APP_USER)
// deliberadamente não tem. Ver docker/init-db/001-create-app-role.sql.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_ADMIN_USER || 'postgres',
  password: process.env.DB_ADMIN_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'inventory_saas',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false, // NUNCA true em produção — sempre via migrations controladas.
  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
```

- [ ] **Step 6: Editar `app.module.ts`**

Modify `backend/src/app.module.ts` — no bloco de imports (linhas 1-25 do arquivo original), remova as 8
linhas que importam entidades individuais (`Company`, `ImportJob`, `CompanyMonthlyRevenue`,
`LossLocation`, `LossReason`, `Loss`, `Product`, `User` — todas de `./modules/**/*.entity`) e acrescente
o import do módulo único. O topo do arquivo passa a ser:

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { ENTITIES } from './database/entities';
import { CompaniesModule } from './modules/companies/companies.module';
import { ImportsModule } from './modules/imports/imports.module';
import { CompanyRevenueModule } from './modules/company-revenue/company-revenue.module';
import { LossLocationsModule } from './modules/loss-locations/loss-locations.module';
import { LossReasonsModule } from './modules/loss-reasons/loss-reasons.module';
import { LossesModule } from './modules/losses/losses.module';
import { ProductsModule } from './modules/products/products.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
```

(Mantenha os `*Module` — só os imports de `*.entity` somem, substituídos pelo import de `ENTITIES`.)

Depois, na chamada `TypeOrmModule.forRootAsync`, troque a linha `entities: [Company, User, Product,
Loss, ImportJob, LossReason, LossLocation, CompanyMonthlyRevenue],` por `entities: ENTITIES,`. O restante
do `useFactory` (host, port, username, password, database, ssl, synchronize, logging) não muda.

Confira, ao final, que nada mais no arquivo referenciava `Company`/`User`/`Product`/`Loss`/`ImportJob`/
`LossReason`/`LossLocation`/`CompanyMonthlyRevenue` diretamente (só os `*Module`s, que continuam
importados normalmente) — se algo mais usar, pare e reporte BLOCKED em vez de adivinhar.

- [ ] **Step 7: Rodar e ver passar**

Run: `npx jest src/database/entities.spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 8: Atualizar `test-db.ts` para usar o módulo único**

Modify `backend/src/test-utils/test-db.ts` — troque as 8 linhas de import de entidades individuais (e a
constante local `TEST_ENTITIES`) pelo import do módulo único. O topo do arquivo passa a ser:

```ts
import { DataSource, EntityManager } from 'typeorm';
import { tenantStorage } from '../common/tenant/tenant-storage';
import { ENTITIES } from '../database/entities';
import { UserRole } from '../modules/users/user.entity';
import { getTestDbConfig, TestDbConfig } from './test-db-config';
import { queryAsAdmin, queryAsOwner } from './test-db-lifecycle';

let cachedConfig: TestDbConfig | undefined;
```

(Remova a linha `// Mesma lista de entidades registrada em app.module.ts (a de data-source.ts está
defasada).` e a linha `export const TEST_ENTITIES = [...]` — nada mais no projeto importa
`TEST_ENTITIES` deste arquivo, conferido por grep.) Na função `appDataSource()`, troque `entities:
TEST_ENTITIES,` por `entities: ENTITIES,`. O restante do arquivo (`testDbConfig`, `cachedAppDataSource`,
`adminQuery`, `ownerQuery`, `closeTestConnections`, `withTenant`, `seedCompany`, `seedProduct`,
`truncateAll`) não muda.

- [ ] **Step 9: Rodar toda a suíte unitária e checar tipos**

Run: `npm test 2>&1 | tail -6 && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Expected: +1 suíte (`entities.spec.ts`) e +3 testes em relação ao baseline do início da Task 1 (ex.: se o
baseline era 17/106, agora é 18/109); `tsc exit=0`.

- [ ] **Step 10: Rodar a suíte de integração (garante que `test-db.ts` continua funcionando com o Postgres real)**

Run: `npm run test:int`
Expected: PASS, mesma contagem de arquivos/testes do fim da Task 1 (nenhum teste de integração foi
adicionado ou removido nesta tarefa).

- [ ] **Step 11: Commit (somente se autorizado)**

```bash
git add backend/src/database/entities.ts backend/src/database/entities.spec.ts backend/src/app.module.ts backend/src/database/data-source.ts backend/src/test-utils/test-db.ts
git commit -m "refactor(backend): módulo único de entidades do TypeORM" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Hardening do harness — privilégios, controle positivo, `getTenantManager()`, `queryWith`

**Files:**
- Modify: `backend/src/test-utils/test-db-lifecycle.ts`
- Modify: `backend/src/test-utils/test-db-lifecycle.spec.ts`
- Modify: `backend/src/test-utils/test-db-lifecycle.int-spec.ts`
- Modify: `backend/src/database/rls-isolation.int-spec.ts` (arquivo já reescrito pela Task 1 — esta
  tarefa só ACRESCENTA dois `it`s a ele, não mexe no que a Task 1 já deixou)

**Interfaces:**
- Consumes: `getTestDbConfig`, `TEST_OWNER_ROLE` de `./test-db-config`; `createTestDatabase`,
  `dropTestDatabase`, `queryAsAdmin` de `./test-db-lifecycle` (já existentes); `withTenant`,
  `seedCompany`, `adminQuery` de `../test-utils/test-db` (para o arquivo de RLS); `getTenantManager` de
  `../common/tenant/tenant-storage` (novo consumo). Depende da Task 1 já ter reescrito
  `rls-isolation.int-spec.ts` (mesmo arquivo).
- Produces: `queryWith` passa a ser exportado de `test-db-lifecycle.ts` (só para o teste unitário desta
  tarefa; nenhuma tarefa futura precisa dele necessariamente, mas fica disponível).

- [ ] **Step 1: Escrever o teste de privilégios (vai falhar)**

Modify `backend/src/test-utils/test-db-lifecycle.int-spec.ts` — acrescente este `it` dentro do
`describe('harness — banco de teste, migrations em etapas e privilégios', ...)`, logo depois do `it`
"reproduz o ambiente real...":

```ts
  it('dono e role de runtime não têm superusuário nem BYPASSRLS', async () => {
    await createTestDatabase(cfg);

    const roles = await queryAsAdmin(
      cfg,
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [[TEST_OWNER_ROLE, cfg.appUser]],
    );

    expect(roles).toHaveLength(2);
    for (const role of roles) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
    }
  });
```

(`TEST_OWNER_ROLE` e `queryAsAdmin` já estão importados no topo do arquivo; `cfg` já existe.)

- [ ] **Step 2: Rodar e ver passar (é uma caracterização do ambiente real, não uma correção de código — deve passar de primeira; se falhar, é um achado real, não um bug do teste)**

Run: `npm run test:int -- src/test-utils/test-db-lifecycle.int-spec.ts`
Expected: PASS — 3 testes agora (era 2). Se FALHAR, pare e reporte BLOCKED com o resultado exato: ou o
role `inventory_saas_test_owner` já existe no Postgres local com `BYPASSRLS`/`SUPERUSER` de uma execução
anterior a este projeto (recrie-o manualmente: `DROP ROLE inventory_saas_test_owner;` via `psql`/cliente
administrativo e rode de novo), ou é um achado real que precisa de decisão do usuário — não "corrija" o
teste para passar.

- [ ] **Step 3: Escrever o teste de controle positivo do `WITH CHECK` (vai falhar por não existir ainda)**

Modify `backend/src/database/rls-isolation.int-spec.ts` — acrescente este `it` logo depois do `it` "a
empresa A não consegue gravar produto em nome da B (WITH CHECK)":

```ts
  it('a empresa A consegue gravar produto em nome dela mesma (controle positivo do WITH CHECK)', async () => {
    const a = await seedCompany('Empresa A');

    await withTenant({ companyId: a }, (manager) =>
      manager.query(`INSERT INTO products ("companyId", barcode, name) VALUES ($1, 'ok-5555', 'Produto válido')`, [a]),
    );

    const [{ n }] = await adminQuery('SELECT count(*)::int AS n FROM products WHERE barcode = $1', ['ok-5555']);
    expect(n).toBe(1);
  });
```

- [ ] **Step 4: Escrever o teste de cobertura de `getTenantManager()` (vai falhar por não existir ainda)**

Modify `backend/src/database/rls-isolation.int-spec.ts` — acrescente o import de `getTenantManager` no
topo (`import { getTenantManager } from '../common/tenant/tenant-storage';`, logo depois do import de
`QueryRunner`) e este `it`, logo depois do teste de controle positivo do Step 3:

```ts
  it('getTenantManager() dentro de withTenant devolve o manager da mesma transação (contrato do middleware)', async () => {
    const a = await seedCompany('Empresa Contexto');
    await seedProduct({ companyId: a, barcode: '6666' });

    const viaContexto = await withTenant({ companyId: a }, async () => getTenantManager().find(Product));

    expect(viaContexto).toHaveLength(1);
  });
```

- [ ] **Step 5: Rodar e ver os dois novos testes passarem**

Run: `npm run test:int -- src/database/rls-isolation.int-spec.ts`
Expected: PASS — 8 testes agora neste arquivo (era 6: +1 controle positivo, +1 `getTenantManager`).

- [ ] **Step 6: Escrever o teste unitário do guard de `queryWith` (vai falhar: `queryWith` não é exportado ainda)**

Modify `backend/src/test-utils/test-db-lifecycle.spec.ts` — leia o arquivo primeiro para manter o
padrão dos dois testes existentes (fixture `ENV`, import de `getTestDbConfig`); acrescente o import de
`queryWith` e este `it` ao final do `describe` existente:

```ts
  it('queryWith recusa quando credentials.database diverge de cfg.database (mesmo com cfg.database válido)', async () => {
    const cfg = getTestDbConfig(undefined, ENV); // cfg.database = 'inventory_saas_test', válido
    await expect(
      queryWith(cfg, { user: cfg.adminUser, password: cfg.adminPassword, database: 'inventory_saas' }, 'SELECT 1', []),
    ).rejects.toThrow(/_test/);
  });
```

(Ajuste o nome da variável de fixture ao que o arquivo já usa — hoje é `ENV`, confira ao ler o arquivo.)

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx jest src/test-utils/test-db-lifecycle.spec.ts`
Expected: FAIL — `queryWith` não é exportado de `./test-db-lifecycle` (erro de tipo/import, ou
`undefined is not a function`).

- [ ] **Step 8: Exportar `queryWith` e assertar `credentials.database`**

Modify `backend/src/test-utils/test-db-lifecycle.ts` — troque `async function queryWith(` por `export
async function queryWith(`, e dentro da função troque `assertTestDatabaseName(cfg.database);` por:

```ts
  // Asserta o banco que a conexão REALMENTE vai usar (credentials.database), não cfg.database — hoje
  // os dois são sempre idênticos nas duas chamadas públicas (queryAsAdmin/queryAsOwner), mas a
  // checagem viraria teatro se um chamador futuro montasse `credentials` com um banco diferente.
  assertTestDatabaseName(credentials.database);
```

Nada mais na função muda.

- [ ] **Step 9: Rodar e ver passar**

Run: `npx jest src/test-utils/test-db-lifecycle.spec.ts`
Expected: PASS — 3 testes agora (era 2).

- [ ] **Step 10: Checagem final de toda a sub-etapa 1.2.1**

Run, em sequência (nunca em paralelo):
```bash
cd /c/PROJETOS/SAAS/backend
npm test
npm run test:int
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git status --short backend | head -30
```
Expected:
- `npm test`: baseline do início da Task 1 **+ 1 suíte (`entities.spec.ts`) + 4 testes** (3 de
  `entities.spec.ts` + 1 de `queryWith` em `test-db-lifecycle.spec.ts`). Se o baseline inicial era
  17/106, o esperado é **18 suítes / 110 testes**.
- `npm run test:int`: baseline do início da Task 1 **+ 2 testes** (privilégios do dono/role de runtime,
  em `test-db-lifecycle.int-spec.ts`) **+ 2 testes** (controle positivo do `WITH CHECK` e
  `getTenantManager()`, em `rls-isolation.int-spec.ts`) — o teste irmão do F18 já foi removido na Task 1
  e o novo teste de `users` já foi contado lá. Se o baseline inicial era 4 arquivos/14 testes, o esperado
  é **4 arquivos / 18 testes**.
- `tsc exit=0`.
- `git status`: só os arquivos da tabela "Estrutura de arquivos" no início deste plano (nenhuma outra
  migration, nenhum arquivo fora de `backend/src/database` e `backend/src/test-utils`).

- [ ] **Step 11: Commit (somente se autorizado)**

```bash
git add backend/src/test-utils/test-db-lifecycle.ts backend/src/test-utils/test-db-lifecycle.spec.ts backend/src/test-utils/test-db-lifecycle.int-spec.ts backend/src/database/rls-isolation.int-spec.ts
git commit -m "test(backend): hardening do harness — privilégios, controle positivo do WITH CHECK, getTenantManager, guard de queryWith" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Auto-revisão (executada ao escrever o plano)

**Cobertura do spec (seção 4, "Sub-etapa 1.2.1"):**
- Migration `NULLIF(...)::uuid` nas 7 políticas, incluindo o ramo `IS NULL` de `users` → Task 1, Step 3.
- Un-skip do F18 (`it.failing` → `it()`, teste irmão removido) → Task 1, Step 4.
- Módulo único de entidades consumido pelos 3 lugares → Task 2 inteira.
- `rolsuper=false`/`rolbypassrls=false` do dono e do role de runtime → Task 3, Steps 1-2.
- Controle positivo do `WITH CHECK` → Task 3, Steps 3, 5.
- Cobertura de `getTenantManager()` dentro de `withTenant` → Task 3, Steps 4-5.
- `queryWith` assertando `credentials.database` → Task 3, Steps 6-9.
- "Pronto quando" do spec → Task 3, Step 10.

**Varredura de placeholders:** nenhum "TBD"/"implementar depois"; os únicos textos condicionais são as
instruções de PARAR e reportar BLOCKED em cenários de falha inesperada (Task 1 Step 5, Task 3 Steps 2 e
6), que são orientação de processo, não lacunas de especificação.

**Consistência de tipos/nomes:** `ENTITIES` (Task 2) é usado com o mesmo nome e tipo em `data-source.ts`,
`app.module.ts` e `test-db.ts`; `onReusedConnection<T>` (Task 1) tem a mesma assinatura em sua definição
e nos dois usos (`queryOnReusedConnection` e o teste de `users`); `queryWith` (Task 3) é exportado com a
mesma assinatura `(cfg, credentials, sql, params)` já usada internamente por `queryAsAdmin`/`queryAsOwner`.

**Conflitos entre tarefas:** Task 1 e Task 3 escrevem no mesmo arquivo (`rls-isolation.int-spec.ts`) —
Task 3 está marcada como dependente da Task 1 e só ACRESCENTA `it`s depois do conteúdo que a Task 1
deixou; nenhuma tarefa reescreve uma seção que a outra também toca. Task 2 não compartilha arquivo com
nenhuma das outras duas.

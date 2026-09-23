# SP1 · Sub-etapa 1.2.2 — Histórico de preço e valor congelado da perda — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duas migrations que dão à "perda" um valor congelado e histórico de preço ao produto, sem tocar
código de aplicação ainda (isso é a sub-etapa 1.2.3). Ao final, todo produto tem histórico de preço
completo (com backfill) e toda perda tem `unitPriceAtLoss`/`unitCostAtLoss`/`valuationSource` preenchidos
(com backfill), prontos para a 1.2.3 passar a gravá-los de verdade em vez de depender do trigger de
segurança.

**Architecture:** `product_price_history` é uma tabela append-only alimentada por um trigger em
`products` (dispara em toda mudança de preço/custo, não só quando o backend novo existir — cobre também
a importação atual e edição em massa futura, sem precisar chamar nenhum serviço). `losses` ganha 3
colunas com um trigger `BEFORE INSERT` que só age como rede de segurança (preenche com o preço atual só
se a aplicação não informar o valor — a partir da 1.2.3 ela sempre vai informar). Os backfills de ambas
rodam sob um helper novo (`withoutForcedRls`) que desliga `FORCE ROW LEVEL SECURITY` temporariamente —
sem ele, uma migration rodando como dono não superusuário (padrão deste projeto, imita banco gerenciado)
falharia ao tentar gravar/ler dados de todas as empresas de uma vez.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL 16 (funções/triggers em `plpgsql`), Jest 29, harness de
integração da etapa 1.1/1.2.1 (`npm run test:int`, banco `inventory_saas_test`, Postgres real em Docker).

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md)
(seção 4.1, "Migrations (sub-etapa 1.2.2)"). Contexto maior: [desenho mestre](../specs/2026-09-20-cadastros-2-0-design-mestre.md),
risco RK1 (linha ~441 do mestre).

## Global Constraints

- **Fora de escopo deste plano:** qualquer entidade TypeORM, `LossesService`, `resolveLossValuation`,
  endpoints novos, ou mudança na web — isso é a sub-etapa 1.2.3 (seção 4.2 do spec). Este plano só cria
  as duas migrations e as testa via SQL bruto pelo harness (sem precisar de entidade nova).
- **Predicado de RLS único:** toda política nova deste plano usa
  `"companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid` — nunca o padrão
  antigo sem `NULLIF` (é exatamente o bug que a sub-etapa 1.2.1 corrigiu; copiar o padrão velho de uma
  migration anterior a `1700000010000` reintroduziria o F18 na tabela nova).
- **Backfill sob RLS forçada (RK1):** toda migration que grava/lê dados de mais de uma empresa numa só
  operação usa o helper `withoutForcedRls` (Task 1) — sem ele, rodando como dono não superusuário, a
  operação falha (viola `WITH CHECK`) ou silenciosamente não vê nenhuma linha (viola `USING`), dependendo
  do lado.
- **Numeração de migrations:** `1700000011000-ProductPriceHistory`, depois
  `1700000012000-LossValuationSnapshot` (a última hoje é `1700000010000-RlsReusedConnectionFix`, da
  sub-etapa 1.2.1, já mesclada em `main`).
- **`down()` sempre existe**, mesmo que "melhor esforço" (padrão já usado no projeto): remove o que a
  migration criou, sem tentar recuperar dados que o backfill preencheu de forma aproximada.
- **NUNCA rodar `npm run test:int` concorrentemente** com outra execução (o `globalSetup` recria o banco
  compartilhado `inventory_saas_test`, e este plano também usa **dois bancos próprios** — nomes terminados
  em `_test` — para os testes de backfill, que precisam de estado parcialmente migrado).
- **Banco de desenvolvimento `inventory_saas` nunca é tocado** por este plano. Aplicar as migrations lá
  (`npm run migration:run`) é decisão e ação do usuário, fora deste plano — e só depois de aplicar também
  `1700000010000` (F18), que ainda não foi aplicada lá segundo o registro da sub-etapa 1.2.1.
- **Commits:** só se o usuário autorizar explicitamente antes da execução. Sem autorização, implementadores
  não rodam `git add`/`git commit` — implementam, testam e reportam.
- Todos os comandos rodam a partir de `C:\PROJETOS\SAAS\backend` (`cd /c/PROJETOS/SAAS/backend` no Git
  Bash). Pré-requisito: `docker ps` deve listar `backend-postgres-1` como `healthy`.
- **Baseline no início deste plano (confirme antes da Task 1):** `npm test` = **18 suítes / 110 testes**;
  `npm run test:int` = **4 arquivos / 17 testes**; `tsc --noEmit` limpo. Trate os números dos steps
  seguintes como deltas sobre o que você mesmo confirmar, não como absolutos — se não baterem, recalcule
  a partir do baseline real e reporte a diferença, sem alterar a asserção do teste em si.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/database/helpers/rls.ts` | criar | `withoutForcedRls` (RK1) e o predicado canônico de tenant |
| `backend/src/database/migrations/1700000011000-ProductPriceHistory.ts` | criar | Tabela, RLS, trigger em `products`, backfill |
| `backend/src/database/product-price-history.int-spec.ts` | criar | Trigger, RLS e backfill da tabela nova |
| `backend/src/database/migrations/1700000012000-LossValuationSnapshot.ts` | criar | Colunas novas em `losses`, backfill, trigger de segurança |
| `backend/src/database/loss-valuation-snapshot.int-spec.ts` | criar | Backfill e trigger de segurança |

---

### Task 1: Helpers de migration — `withoutForcedRls` e o predicado de tenant

**Files:**
- Create: `backend/src/database/helpers/rls.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa deste plano).
- Produces: `TENANT_COMPANY_ID_PREDICATE: string` — a expressão SQL
  `"companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid`, para interpolar em
  `CREATE POLICY ... USING (...) WITH CHECK (...)`. `withoutForcedRls(queryRunner: QueryRunner, tables:
  string[], fn: () => Promise<void>): Promise<void>` — desliga `FORCE ROW LEVEL SECURITY` nas tabelas
  listadas, roda `fn`, religa ao final (mesmo se `fn` lançar). Ambos usados pelas Tasks 2 e 3.

Este arquivo fica **fora** de `src/database/migrations/` de propósito: o CLI do TypeORM
(`data-source.ts`, `migrations: [__dirname + '/migrations/*.{ts,js}']`) e o harness de teste
(`test-db-lifecycle.ts`, `loadMigrationClasses`, que filtra por `/^\d{13}-.+\.ts$/` dentro da pasta
`migrations`) carregam qualquer arquivo de lá como se fosse uma migration — um helper dentro da pasta
seria tratado como classe de migration por engano.

- [ ] **Step 1: Criar o arquivo (sem TDD — é infraestrutura pura, sem lógica condicional própria; será
  exercitado pelos testes de integração das Tasks 2 e 3, que falhariam sem ele funcionar corretamente)**

Create `backend/src/database/helpers/rls.ts`:

```ts
import { QueryRunner } from 'typeorm';

/**
 * Predicado canônico de isolamento por tenant, para toda política de RLS nova. Usa NULLIF(...) antes
 * do cast ::uuid — a correção do F18 (sub-etapa 1.2.1, migration 1700000010000-RlsReusedConnectionFix):
 * numa conexão do pool reaproveitada sem contexto de tenant, current_setting(..., true) pode devolver
 * '' (texto vazio) em vez de NULL, e o cast ''::uuid lançaria erro em vez de simplesmente não bater com
 * nenhuma linha. NÃO copiar o padrão antigo (current_setting(...)::uuid sem o NULLIF) das migrations
 * anteriores a 1700000010000 — elas ainda estão no disco porque uma migration já aplicada não se edita
 * retroativamente, mas o padrão delas é o que causava o F18.
 */
export const TENANT_COMPANY_ID_PREDICATE =
  `"companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid`;

/**
 * Roda `fn` com FORCE ROW LEVEL SECURITY temporariamente DESLIGADA nas tabelas listadas, dentro da
 * mesma transação da migration, e sempre religa ao final (mesmo se `fn` lançar).
 *
 * Por quê: as migrations deste projeto rodam como DONO das tabelas, mas SEM superusuário (imita banco
 * gerenciado — ver `test-db-lifecycle.ts`, `createTestDatabase`), e todas as tabelas de tenant têm
 * FORCE ROW LEVEL SECURITY — que faz a política valer até para o dono. Um backfill que lê ou grava
 * dados de TODAS as empresas de uma vez (a migration não tem "empresa atual") ficaria bloqueado: a
 * cláusula USING faria um SELECT enxergar zero linhas, e a WITH CHECK faria um INSERT/UPDATE falhar —
 * sem aviso nenhum no primeiro caso, com erro no segundo. NO FORCE (o padrão do Postgres — só quem
 * explicitamente pede FORCE fica sujeito à própria política sendo dono) resolve os dois casos para o
 * dono, sem abrir a tabela para mais ninguém: o role de runtime da aplicação (inventory_saas_app,
 * NUNCA o dono) continua sujeito à RLS o tempo todo, inclusive durante o backfill.
 */
export async function withoutForcedRls(
  queryRunner: QueryRunner,
  tables: string[],
  fn: () => Promise<void>,
): Promise<void> {
  for (const table of tables) {
    await queryRunner.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
  }
  try {
    await fn();
  } finally {
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
  }
}
```

- [ ] **Step 2: Checar tipos**

Run: `npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Expected: `tsc exit=0` (o arquivo não é usado em lugar nenhum ainda, mas precisa compilar sozinho).

- [ ] **Step 3: Commit (somente se o usuário já autorizou commits)**

```bash
git add backend/src/database/helpers/rls.ts
git commit -m "feat(backend): helpers de migration para RLS (predicado canônico + backfill sob FORCE)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration `1700000011000-ProductPriceHistory`

**Files:**
- Create: `backend/src/database/migrations/1700000011000-ProductPriceHistory.ts`
- Create: `backend/src/database/product-price-history.int-spec.ts`

**Interfaces:**
- Consumes: `TENANT_COMPANY_ID_PREDICATE`, `withoutForcedRls` de `./helpers/rls` (Task 1). No teste,
  consome os helpers já existentes do harness (`adminQuery`, `appDataSource`, `closeTestConnections`,
  `ownerQuery`, `seedCompany`, `seedProduct`, `truncateAll`, `withTenant` de `../test-utils/test-db`; e,
  para os testes de backfill em banco próprio, `getTestDbConfig`, `createTestDatabase`, `dropTestDatabase`,
  `queryAsAdmin`, `queryAsOwner`, `runMigrations` de `../test-utils/test-db-lifecycle`).
- Produces: a migration `ProductPriceHistory1700000011000` (aplicada automaticamente pelo `globalSetup`
  em toda execução de `npm run test:int` daqui em diante). A tabela `product_price_history` e o trigger
  `trg_record_product_price_history` em `products` — a Task 3 não depende de nenhum dos dois.

- [ ] **Step 1: Escrever os testes de trigger e RLS (vão falhar: a tabela ainda não existe)**

Create `backend/src/database/product-price-history.int-spec.ts`:

```ts
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function historyRows(productId: string): Promise<
  { unitPrice: string; costPrice: string; source: string; changedByUserId: string | null }[]
> {
  return adminQuery(
    `SELECT "unitPrice", "costPrice", source, "changedByUserId"
       FROM product_price_history WHERE "productId" = $1 ORDER BY seq ASC`,
    [productId],
  );
}

describe('product_price_history — trigger em products e RLS', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('criar um produto gera exatamente 1 linha de histórico', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1001', unitPrice: 10, costPrice: 6 });

    const rows = await historyRows(productId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unitPrice: '10.00', costPrice: '6.00', source: 'manual' });
  });

  it('mudar o preço ou o custo gera outra linha', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1002', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId }, (manager) =>
      manager.query(`UPDATE products SET "unitPrice" = 12 WHERE id = $1`, [productId]),
    );

    const rows = await historyRows(productId);
    expect(rows).toHaveLength(2);
    expect(rows[1].unitPrice).toBe('12.00');
  });

  it('mudar outro campo (não preço/custo) NÃO gera linha nova', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1003', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId }, (manager) =>
      manager.query(`UPDATE products SET name = 'Outro nome' WHERE id = $1`, [productId]),
    );

    expect(await historyRows(productId)).toHaveLength(1);
  });

  it('gravar o MESMO preço de novo NÃO gera linha nova', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const productId = await seedProduct({ companyId, barcode: '1004', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId }, (manager) =>
      manager.query(`UPDATE products SET "unitPrice" = 10 WHERE id = $1`, [productId]),
    );

    expect(await historyRows(productId)).toHaveLength(1);
  });

  it('changedByUserId e source vêm das variáveis de sessão (app.current_user_id / app.change_source)', async () => {
    const companyId = await seedCompany('Empresa Trigger');
    const userId = await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', 'manager', $3) RETURNING id`,
      ['Gerente de teste', 'gerente-price-history@teste.local', companyId],
    ).then((rows) => rows[0].id as string);
    const productId = await seedProduct({ companyId, barcode: '1005', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId, userId }, async (manager) => {
      await manager.query(`SELECT set_config('app.change_source', 'import', true)`);
      await manager.query(`UPDATE products SET "unitPrice" = 15 WHERE id = $1`, [productId]);
    });

    const rows = await historyRows(productId);
    expect(rows[1]).toMatchObject({ source: 'import', changedByUserId: userId });
  });

  it('a empresa A não enxerga histórico de preço da empresa B (RLS)', async () => {
    const a = await seedCompany('Empresa A Preço');
    const b = await seedCompany('Empresa B Preço');
    await seedProduct({ companyId: a, barcode: '2001' });
    await seedProduct({ companyId: b, barcode: '2002' });

    const visiveisParaA = await withTenant({ companyId: a }, (manager) =>
      manager.query('SELECT "companyId" FROM product_price_history'),
    );

    expect(visiveisParaA).toHaveLength(1);
    expect(visiveisParaA[0].companyId).toBe(a);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/database/product-price-history.int-spec.ts`
Expected: FAIL — `relation "product_price_history" does not exist` (a tabela ainda não existe; a
migration só será criada no Step 3).

- [ ] **Step 3: Criar a migration**

Create `backend/src/database/migrations/1700000011000-ProductPriceHistory.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE, withoutForcedRls } from '../helpers/rls';

/**
 * Histórico de preço/custo do produto (sub-etapa 1.2.2 — spec do SP1, seção 4.1). Append-only,
 * alimentado por um trigger em products — funciona para TODO escritor (painel, importação atual,
 * edição em massa futura, ERP), sem precisar chamar nenhum serviço.
 */
export class ProductPriceHistory1700000011000 implements MigrationInterface {
  name = 'ProductPriceHistory1700000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_price_history" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "seq"             bigint GENERATED ALWAYS AS IDENTITY,
        "companyId"       uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "productId"       uuid NOT NULL REFERENCES "products"("id")  ON DELETE CASCADE,
        "unitPrice"       numeric(12,2) NOT NULL,
        "costPrice"       numeric(12,2) NOT NULL,
        "validFrom"       timestamptz   NOT NULL,
        "changedByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "source"          varchar(20) NOT NULL DEFAULT 'manual'
                          CHECK ("source" IN ('manual','import','bulk','retro_fix','erp','approval','backfill')),
        "createdAt"       timestamptz   NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_price_history_product_valid"
        ON "product_price_history" ("productId", "validFrom" DESC, "seq" DESC)
    `);

    await queryRunner.query(`ALTER TABLE "product_price_history" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "product_price_history" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_product_price_history" ON "product_price_history"
      USING (${TENANT_COMPANY_ID_PREDICATE})
      WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'GRANT SELECT, INSERT ON "product_price_history" TO inventory_saas_app';
        END IF;
      END
      $$
    `);

    // Dispara em toda mudança de preço/custo — inclusive a gravada pelo próprio backfill abaixo? NÃO:
    // o trigger é AFTER INSERT/UPDATE em "products", e o backfill só faz INSERT em
    // product_price_history diretamente, sem tocar "products" — então não há dupla contagem.
    await queryRunner.query(`
      CREATE FUNCTION record_product_price_history() RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT'
          OR NEW."unitPrice" IS DISTINCT FROM OLD."unitPrice"
          OR NEW."costPrice" IS DISTINCT FROM OLD."costPrice"
        THEN
          INSERT INTO product_price_history
            ("companyId", "productId", "unitPrice", "costPrice", "validFrom", "changedByUserId", "source")
          VALUES (
            NEW."companyId",
            NEW.id,
            NEW."unitPrice",
            NEW."costPrice",
            clock_timestamp(),
            NULLIF(current_setting('app.current_user_id', true), '')::uuid,
            COALESCE(NULLIF(current_setting('app.change_source', true), ''), 'manual')
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_record_product_price_history
        AFTER INSERT OR UPDATE OF "unitPrice", "costPrice" ON "products"
        FOR EACH ROW EXECUTE FUNCTION record_product_price_history()
    `);

    // Backfill: uma linha por produto já existente, com o preço/custo ATUAL (o valor real do passado
    // é irrecuperável) e validFrom = a criação do produto. Sem withoutForcedRls, o SELECT em "products"
    // não enxergaria nenhuma linha (nenhuma empresa "atual" durante uma migration) e o INSERT em
    // product_price_history falharia na WITH CHECK pelo mesmo motivo — ver RK1 no desenho mestre.
    await withoutForcedRls(queryRunner, ['products', 'product_price_history'], async () => {
      await queryRunner.query(`
        INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", "source")
        SELECT "companyId", "id", "unitPrice", "costPrice", "createdAt", 'backfill'
        FROM products
      `);
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_record_product_price_history ON "products"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS record_product_price_history()`);
    await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_product_price_history" ON "product_price_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_price_history"`);
  }
}
```

- [ ] **Step 4: Rodar de novo e ver passar**

Run: `npm run test:int -- src/database/product-price-history.int-spec.ts`
Expected: PASS — 6 testes (o `globalSetup` recria o banco compartilhado a cada execução de
`npm run test:int`, então a migration nova já vale nesta mesma chamada — não precisa de uma segunda
rodada, ao contrário do que um plano anterior desta série assumiu por engano).

- [ ] **Step 5: Escrever o teste de backfill em banco próprio (vai falhar: arquivo não existe)**

Modify `backend/src/database/product-price-history.int-spec.ts` — acrescente ao final do arquivo (fora
do `describe` existente, mas no mesmo arquivo):

```ts
import { createTestDatabase, dropTestDatabase, getTestDbConfig, queryAsAdmin, queryAsOwner, runMigrations } from '../test-utils/test-db-lifecycle';

describe('product_price_history — backfill (banco próprio, migração em etapas)', () => {
  const cfg = getTestDbConfig('product_price_history_backfill_test');

  afterAll(() => dropTestDatabase(cfg));

  it('todo produto já existente ganha 1 linha de histórico com o preço atual, em TODAS as empresas', async () => {
    // Banco só até a sub-etapa 1.2.1 (inclui a correção do F18, sem a qual o backfill abaixo já
    // falharia por outro motivo) — "legado" = produtos criados ANTES do trigger existir.
    await createTestDatabase(cfg, { migrateUpTo: '1700000010000' });

    const companyA = (await queryAsAdmin(cfg, `INSERT INTO companies (name, status) VALUES ('A', 'active') RETURNING id`))[0].id;
    const companyB = (await queryAsAdmin(cfg, `INSERT INTO companies (name, status) VALUES ('B', 'active') RETURNING id`))[0].id;
    const productA = (await queryAsAdmin(
      cfg,
      `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice") VALUES ($1, 'legado-a', 'Legado A', 20, 12) RETURNING id`,
      [companyA],
    ))[0].id;
    const productB = (await queryAsAdmin(
      cfg,
      `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice") VALUES ($1, 'legado-b', 'Legado B', 30, 18) RETURNING id`,
      [companyB],
    ))[0].id;

    // Sem withoutForcedRls, este INSERT já teria falhado (WITH CHECK) durante o migrate acima — chegar
    // até aqui só prova que a migration RODOU, não que o backfill alcançou as DUAS empresas de uma vez.
    await runMigrations(cfg);

    const rows = await queryAsAdmin(
      cfg,
      `SELECT "companyId", "productId", "unitPrice", "costPrice", source FROM product_price_history ORDER BY "productId"`,
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ companyId: companyA, productId: productA, unitPrice: '20.00', source: 'backfill' }),
        expect.objectContaining({ companyId: companyB, productId: productB, unitPrice: '30.00', source: 'backfill' }),
      ]),
    );

    // Confere também que o helper religou FORCE ao final — o dono não deve enxergar nada sem tenant.
    const comoDono = await queryAsOwner(cfg, 'SELECT count(*)::int AS n FROM product_price_history');
    expect(comoDono[0].n).toBe(0);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar por outro motivo (confirma que o import por si só não passa)**

Run: `npx jest --config jest.integration.config.js src/database/product-price-history.int-spec.ts`
Expected: se o `withoutForcedRls`/migration já estiverem corretos (Steps 1-4 já os criaram), este teste
deve **passar de primeira** — ele caracteriza o comportamento correto, não corrige um bug. Se falhar,
leia a mensagem: `violates row-level security policy` indica que algo no `withoutForcedRls` ou na ordem
das tabelas está errado (confira se `products` também está na lista, não só
`product_price_history`) — corrija a migration do Step 3, não o teste.

- [ ] **Step 7: Checagem final da tarefa**

Run:
```bash
cd /c/PROJETOS/SAAS/backend
npm test
npm run test:int
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```
Expected: `npm test` inalterado (nenhum teste unitário novo nesta tarefa); `npm run test:int` = baseline
do início da Task 2 **+ 7 testes** (6 do Step 1 + 1 do Step 5) — se o baseline era 4 arquivos/17 testes,
agora são **5 arquivos / 24 testes**; `tsc exit=0`.

- [ ] **Step 8: Commit (somente se autorizado)**

```bash
git add backend/src/database/migrations/1700000011000-ProductPriceHistory.ts backend/src/database/product-price-history.int-spec.ts
git commit -m "feat(backend): histórico de preço do produto (product_price_history)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration `1700000012000-LossValuationSnapshot`

**Files:**
- Create: `backend/src/database/migrations/1700000012000-LossValuationSnapshot.ts`
- Create: `backend/src/database/loss-valuation-snapshot.int-spec.ts`

**Interfaces:**
- Consumes: `withoutForcedRls` de `./helpers/rls` (Task 1); os mesmos helpers do harness que a Task 2 usou.
  Não depende da tabela `product_price_history` da Task 2 (lê preço/custo direto de `products`, a fonte
  "atual" — o valor real do passado continua sendo capturado pela `product_price_history` em paralelo,
  mas os dois não se referenciam um ao outro nesta sub-etapa).
- Produces: a migration `LossValuationSnapshot1700000012000`. As 3 colunas novas em `losses`
  (`unitPriceAtLoss`, `unitCostAtLoss`, `valuationSource`) e o trigger de segurança
  `trg_losses_valuation_fallback` — a sub-etapa 1.2.3 vai gravar essas colunas de verdade a partir da
  aplicação; até lá, o trigger é quem preenche.

- [ ] **Step 1: Escrever os testes (vão falhar: as colunas ainda não existem)**

Create `backend/src/database/loss-valuation-snapshot.int-spec.ts`:

```ts
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function insertLoss(params: {
  companyId: string;
  productId: string;
  locationId: string;
  reasonId: string;
  userId: string;
}): Promise<string> {
  const rows = await withTenant({ companyId: params.companyId }, (manager) =>
    manager.query(
      `INSERT INTO losses
         ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId", "occurredAt")
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now())
       RETURNING id`,
      [params.companyId, params.productId, params.userId, params.locationId, params.reasonId],
    ),
  );
  return rows[0].id;
}

/** Cria o mínimo que uma perda exige (usuário, local, motivo) direto por SQL — sem depender de entidade nova. */
async function seedLossPrerequisites(companyId: string) {
  const userId = (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', 'employee', $3) RETURNING id`,
      ['Funcionário de teste', `func-${companyId}@teste.local`, companyId],
    )
  )[0].id;
  const locationId = (
    await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId])
  )[0].id;
  const reasonId = (
    await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId])
  )[0].id;
  return { userId, locationId, reasonId };
}

describe('losses — valor congelado: trigger de segurança e restrições', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('perda inserida SEM valor congelado é preenchida pelo trigger com o preço atual do produto', async () => {
    const companyId = await seedCompany('Empresa Fallback');
    const productId = await seedProduct({ companyId, barcode: '3001', unitPrice: 25, costPrice: 15 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyId);

    const lossId = await insertLoss({ companyId, productId, locationId, reasonId, userId });

    const [loss] = await adminQuery(
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '25.00', unitCostAtLoss: '15.00', valuationSource: 'fallback_current' });
  });

  it('perda inserida COM valor congelado explícito não é sobrescrita pelo trigger', async () => {
    const companyId = await seedCompany('Empresa Explícito');
    const productId = await seedProduct({ companyId, barcode: '3002', unitPrice: 25, costPrice: 15 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyId);

    const lossId = (
      await withTenant({ companyId }, (manager) =>
        manager.query(
          `INSERT INTO losses
             ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId",
              "occurredAt", "unitPriceAtLoss", "unitCostAtLoss", "valuationSource")
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now(), 999.99, 888.88, 'snapshot')
           RETURNING id`,
          [companyId, productId, userId, locationId, reasonId],
        ),
      )
    )[0].id;

    const [loss] = await adminQuery(
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '999.99', unitCostAtLoss: '888.88', valuationSource: 'snapshot' });
  });

  it('perda referenciando produto de OUTRA empresa falha alto (NOT NULL), não grava valor zerado', async () => {
    const companyA = await seedCompany('Empresa A Cruzada');
    const companyB = await seedCompany('Empresa B Cruzada');
    const productOfB = await seedProduct({ companyId: companyB, barcode: '3003', unitPrice: 40, costPrice: 20 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyA);

    // O FK não impede o cruzamento (não sabe de tenant); a sessão de A não enxerga o produto de B via
    // RLS, então o SELECT do trigger vem vazio e a coluna NOT NULL barra o INSERT — falha alto em vez
    // de gravar um prejuízo de R$ 0,00 por engano.
    await expect(insertLoss({ companyId: companyA, productId: productOfB, locationId, reasonId, userId })).rejects.toThrow(
      /null value in column "unitPriceAtLoss"/,
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/database/loss-valuation-snapshot.int-spec.ts`
Expected: FAIL — `column "unitPriceAtLoss" of relation "losses" does not exist` (ou erro equivalente; as
colunas ainda não existem).

- [ ] **Step 3: Criar a migration**

Create `backend/src/database/migrations/1700000012000-LossValuationSnapshot.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { withoutForcedRls } from '../helpers/rls';

/**
 * Valor congelado da perda (sub-etapa 1.2.2 — spec do SP1, seção 4.1). A partir da sub-etapa 1.2.3 a
 * aplicação passa a gravar unitPriceAtLoss/unitCostAtLoss/valuationSource explicitamente (preço
 * vigente em occurredAt, via histórico de product_price_history); até lá — e como rede de segurança
 * depois — o trigger BEFORE INSERT preenche com o preço ATUAL do produto se a aplicação não informar.
 */
export class LossValuationSnapshot1700000012000 implements MigrationInterface {
  name = 'LossValuationSnapshot1700000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "losses"
        ADD COLUMN "unitPriceAtLoss" numeric(12,2),
        ADD COLUMN "unitCostAtLoss"  numeric(12,2),
        ADD COLUMN "valuationSource" varchar(20)
    `);

    // Backfill: preenche as perdas já existentes com o preço ATUAL do produto (o valor real da época
    // é irrecuperável) — sem withoutForcedRls, este UPDATE não enxergaria nenhuma linha de "losses"
    // nem de "products" (nenhuma empresa "atual" durante uma migration) e não faria nada, silenciosamente.
    await withoutForcedRls(queryRunner, ['losses', 'products'], async () => {
      await queryRunner.query(`
        UPDATE "losses" l
        SET "unitPriceAtLoss" = p."unitPrice",
            "unitCostAtLoss"  = p."costPrice",
            "valuationSource" = 'backfill_current'
        FROM "products" p
        WHERE p.id = l."productId"
      `);
    });

    await queryRunner.query(`
      ALTER TABLE "losses"
        ALTER COLUMN "unitPriceAtLoss" SET NOT NULL,
        ALTER COLUMN "unitCostAtLoss"  SET NOT NULL,
        ALTER COLUMN "valuationSource" SET NOT NULL,
        ALTER COLUMN "valuationSource" SET DEFAULT 'snapshot',
        ADD CONSTRAINT "chk_losses_valuation_source" CHECK ("valuationSource" IN
          ('snapshot','backfill_current','fallback_current','recalculated','pending_product'))
    `);

    // Rede de segurança: só age se a aplicação não informar o valor. O SELECT em "products" é
    // filtrado por RLS igual a qualquer outra consulta — fora de contexto de tenant, ou quando
    // productId aponta para produto de OUTRA empresa (bug/dado inconsistente), o SELECT não vê nada,
    // as colunas ficam NULL e a restrição NOT NULL acima barra o INSERT — falha alto de propósito.
    await queryRunner.query(`
      CREATE FUNCTION losses_valuation_fallback() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."unitPriceAtLoss" IS NULL OR NEW."unitCostAtLoss" IS NULL THEN
          SELECT "unitPrice", "costPrice" INTO NEW."unitPriceAtLoss", NEW."unitCostAtLoss"
          FROM products WHERE id = NEW."productId";
          NEW."valuationSource" := 'fallback_current';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_losses_valuation_fallback
        BEFORE INSERT ON "losses"
        FOR EACH ROW EXECUTE FUNCTION losses_valuation_fallback()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_losses_valuation_fallback ON "losses"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS losses_valuation_fallback()`);
    await queryRunner.query(`ALTER TABLE "losses" DROP CONSTRAINT IF EXISTS "chk_losses_valuation_source"`);
    await queryRunner.query(`
      ALTER TABLE "losses"
        DROP COLUMN "unitPriceAtLoss",
        DROP COLUMN "unitCostAtLoss",
        DROP COLUMN "valuationSource"
    `);
  }
}
```

- [ ] **Step 4: Rodar de novo e ver passar**

Run: `npm run test:int -- src/database/loss-valuation-snapshot.int-spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 5: Escrever o teste de backfill em banco próprio (vai falhar: arquivo não existe)**

Modify `backend/src/database/loss-valuation-snapshot.int-spec.ts` — acrescente ao final do arquivo:

```ts
import { createTestDatabase, dropTestDatabase, getTestDbConfig, queryAsAdmin, runMigrations } from '../test-utils/test-db-lifecycle';

describe('losses — backfill do valor congelado (banco próprio, migração em etapas)', () => {
  const cfg = getTestDbConfig('loss_valuation_backfill_test');

  afterAll(() => dropTestDatabase(cfg));

  it('toda perda já existente ganha unitPriceAtLoss/unitCostAtLoss = preço atual do produto, em TODAS as empresas', async () => {
    // Até a 1700000011000 inclusive: cria o produto/histórico, mas ainda SEM as colunas de valor
    // congelado em losses — "legado" = perdas registradas antes desta migration existir.
    await createTestDatabase(cfg, { migrateUpTo: '1700000011000' });

    const companyId = (await queryAsAdmin(cfg, `INSERT INTO companies (name, status) VALUES ('C', 'active') RETURNING id`))[0].id;
    const userId = (
      await queryAsAdmin(
        cfg,
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('U', 'u-loss-backfill@teste.local', 'x', 'employee', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const locationId = (await queryAsAdmin(cfg, `INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Local') RETURNING id`, [companyId]))[0].id;
    const reasonId = (await queryAsAdmin(cfg, `INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Motivo') RETURNING id`, [companyId]))[0].id;
    const productId = (
      await queryAsAdmin(
        cfg,
        `INSERT INTO products ("companyId", barcode, name, "unitPrice", "costPrice") VALUES ($1, 'legado-loss', 'Legado', 50, 30) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const lossId = (
      await queryAsAdmin(
        cfg,
        `INSERT INTO losses ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId", "occurredAt")
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now()) RETURNING id`,
        [companyId, productId, userId, locationId, reasonId],
      )
    )[0].id;

    await runMigrations(cfg);

    const [loss] = await queryAsAdmin(
      cfg,
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '50.00', unitCostAtLoss: '30.00', valuationSource: 'backfill_current' });
  });
});
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx jest --config jest.integration.config.js src/database/loss-valuation-snapshot.int-spec.ts`
Expected: PASS — 4 testes no total do arquivo. Se falhar com `violates row-level security policy` ou
`0 rows affected`, o `withoutForcedRls` do Step 3 está sem `products` ou sem `losses` na lista — corrija
a migration, não o teste.

- [ ] **Step 7: Checagem final de toda a sub-etapa 1.2.2**

Run, em sequência (nunca em paralelo):
```bash
cd /c/PROJETOS/SAAS/backend
npm test
npm run test:int
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git status --short backend | head -30
```
Expected:
- `npm test`: inalterado em relação ao baseline do início deste plano (nenhum teste unitário foi
  criado — só `.int-spec.ts`).
- `npm run test:int`: baseline do início da Task 2 **+ 7 (Task 2) + 4 (Task 3) = +11 testes, em +2
  arquivos**. Se o baseline era 4 arquivos/17 testes, o esperado é **6 arquivos / 28 testes**.
- `tsc exit=0`.
- `git status`: só os 5 arquivos da tabela "Estrutura de arquivos" no início deste plano (nenhuma
  mudança em `app.module.ts`, `data-source.ts`, `entities.ts`, nem nenhum arquivo de aplicação — isso é
  a sub-etapa 1.2.3).

- [ ] **Step 8: Commit (somente se autorizado)**

```bash
git add backend/src/database/migrations/1700000012000-LossValuationSnapshot.ts backend/src/database/loss-valuation-snapshot.int-spec.ts
git commit -m "feat(backend): valor congelado da perda (unitPriceAtLoss/unitCostAtLoss/valuationSource)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Auto-revisão (executada ao escrever o plano)

**Cobertura do spec (seção 4.1, "Migrations sub-etapa 1.2.2"):**
- Tabela `product_price_history` com os 9 campos, índice, RLS, GRANT append-only → Task 2, Step 3.
- Trigger em `products` (AFTER INSERT/UPDATE de preço/custo, `IS DISTINCT FROM`, `validFrom =
  clock_timestamp()`, `changedByUserId`/`source` das variáveis de sessão) → Task 2, Step 3.
- Backfill do histórico de preço → Task 2, Step 3 (via `withoutForcedRls`, RK1).
- Colunas novas em `losses`, backfill, `NOT NULL`+`CHECK`, trigger `BEFORE INSERT` de segurança → Task 3,
  Step 3.
- "Fora de contexto de tenant o SELECT do trigger não enxerga o produto e o INSERT falha alto" → Task 3,
  Step 1 (terceiro teste, cenário de produto de outra empresa) e Step 3 (comentário).
- RK1 (backfill sob FORCE RLS) → Task 1 (helper) + testes de backfill em banco próprio nas Tasks 2 e 3.
- Predicado `NULLIF` da política nova (decisão da revisão final da 1.2.1, já registrada no spec) → Task 1
  (`TENANT_COMPANY_ID_PREDICATE`) + Task 2, Step 3.

**Decisão nova deste plano (não estava no spec, documentada aqui):** o `CHECK` de `source` em
`product_price_history` ganhou o valor `'backfill'`, que o spec original não listava — sem ele, o
backfill teria que mentir e usar `'manual'`, perdendo a distinção entre "mudança real" e "melhor esforço
da migration" que o campo existe para dar (mesmo raciocínio que já levou a `valuationSource` de `losses`
ter `'backfill_current'` separado de `'snapshot'`).

**Varredura de placeholders:** nenhum "TBD"/"implementar depois". As únicas instruções condicionais são
de diagnóstico ("se falhar com X, o problema está em Y, corrija a migration") — orientação de processo,
não lacuna de especificação.

**Consistência de tipos/nomes:** `TENANT_COMPANY_ID_PREDICATE` e `withoutForcedRls` (Task 1) usados com a
mesma assinatura nas Tasks 2 e 3; `getTestDbConfig`/`createTestDatabase`/`dropTestDatabase`/`queryAsAdmin`/
`queryAsOwner`/`runMigrations` (já existentes desde a etapa 1.1) usados da mesma forma que em
`test-db-lifecycle.int-spec.ts`.

**Conflitos entre tarefas:** Task 2 e Task 3 não compartilham nenhum arquivo (cada uma cria sua própria
migration e seu próprio `.int-spec.ts`); ambas dependem só da Task 1. Nenhuma tarefa deste plano toca
`app.module.ts`, `data-source.ts` ou `entities.ts` — a entidade `ProductPriceHistory` e as mudanças em
`Loss`/`LossesService` ficam para a sub-etapa 1.2.3, como o spec já delimita.

# SP1 · Sub-etapa 1.2.3 — Backend do valor congelado — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o backend gravar e usar o valor congelado da perda (preço vigente em `occurredAt`), de modo
que mudar o preço de um produto não altere mais nenhum valor de perda já registrada — em relatório,
alerta, score ou export (correção do F1).

**Architecture:** Uma função `resolveLossValuation` (TypeScript, testável) escolhe o preço no
`product_price_history` criado na 1.2.2; `LossesService.create/update` gravam o resultado nas 3 colunas
novas de `losses`. Todas as consultas e funções puras que hoje multiplicam `quantity × product.unitPrice`
passam a usar `loss.unitPriceAtLoss` (constantes SQL e um helper `lossValue` compartilhados). O middleware
passa a informar `app.current_user_id` e a importação `app.change_source='import'`, para o trigger do
histórico registrar quem/por onde mudou o preço. Uma migration de endurecimento corrige 3 achados menores
da revisão da 1.2.2 nos triggers antes de o middleware começar a preencher o usuário.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL 16, Jest 29 (unitário `npm test`; integração
`npm run test:int`, Postgres real no Docker, banco `inventory_saas_test`), ExcelJS.

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md),
seções 4.2 (backend) e 4.4 (testes). Achados menores da revisão da 1.2.2 que entram aqui: seção 10 do
[desenho mestre](../specs/2026-09-20-cadastros-2-0-design-mestre.md), linha do SP1.

## Global Constraints

- **Fora de escopo:** web (`web-panel/`), app (`mobile_app/`), linha do tempo de preços na UI (sub-etapa
  1.2.4), correção retroativa de preço (SP2), aviso de "valores estimados" no dashboard.
- **Formatos de resposta NÃO mudam** (`totalFinancialLoss`, `totalCostLoss`, `totalQuantity`, colunas do
  xlsx, `LossAlert`, `SuspiciousPatternEntry`) — o painel não precisa de alteração (spec 4.2).
- **Migrations já mescladas (`1700000000000`–`1700000012000`) não se editam.** Mudança em trigger = migration
  nova (`1700000013000-…`), com `CREATE OR REPLACE FUNCTION` e `down()` que restaura a versão anterior.
- **Toda política de RLS nova** usaria `TENANT_COMPANY_ID_PREDICATE` de `src/database/helpers/rls.ts` (este
  plano não cria política nova).
- **Entidade nova** só é registrada em `src/database/entities.ts` (`ENTITIES`) — lista única.
- **`valuationSource`** é a união TS `'snapshot' | 'backfill_current' | 'fallback_current' | 'recalculated' |
  'pending_product'` (mesmos 5 valores do `CHECK` da migration 12000).
- **NUNCA rodar `npm run test:int` concorrentemente** com outra execução (o `globalSetup` recria o banco
  compartilhado). A migration nova já vale na mesma chamada de `test:int` (o banco é recriado a cada vez).
- **Banco de desenvolvimento `inventory_saas` nunca é tocado** por este plano.
- **Commits:** no branch de feature `feat/cadastros-sp1-etapa-1-2-3` (criado a partir de `main`), um por
  tarefa, mensagem terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Merge em
  `main` e push só com confirmação do usuário.
- Comandos a partir de `C:\PROJETOS\SAAS\backend` (`cd /c/PROJETOS/SAAS/backend` no Git Bash).
  Pré-requisito: `docker ps` lista `backend-postgres-1` como `healthy` (se o Docker estiver parado, abrir
  `C:\Users\guzam\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`).
- **Baseline no início (confirme antes da Task 1):** `npm test` = 18 suítes / 110 testes; `npm run
  test:int` = 7 arquivos / 32 testes; `npx tsc --noEmit -p tsconfig.json` limpo. Os números dos steps são
  "baseline + N"; se o baseline real diferir, recalcule e reporte, sem mexer nas asserções.

## Review Focus

1. **Token de usuário já excluído** (JWT ainda válido) editando preço de produto: a edição tem de
   funcionar, com `changedByUserId = NULL` no histórico — não 500 por chave estrangeira. → Task 1, teste
   "usuário inexistente em app.current_user_id".
2. **Relógio do celular atrasado:** perda com `occurredAt` anterior à criação do produto vale o preço mais
   antigo do histórico, não o atual. → Task 2, teste "occurredAt antes da primeira linha".
3. **Duas mudanças de preço com o mesmo `validFrom`** (mesma transação, importação): vale a de maior
   `seq`. → Task 2, teste "desempate por seq".
4. **Formulário de edição reenviando o MESMO `occurredAt`/`productId`** (a web manda todos os campos):
   não pode recalcular o valor congelado. → Task 3, teste "update com os mesmos valores não recalcula".
5. **Reenvio idempotente do app** (mesmo `clientGeneratedId`): devolve o registro existente sem
   recalcular nem regravar. → coberto pelo teste existente "devolve o registro existente…" em
   `losses.service.spec.ts`, que continua passando na Task 3 (o `return existing` vem antes do cálculo).

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/database/migrations/1700000013000-ValuationTriggersHardening.ts` | criar | fallback parcial com `COALESCE`, usuário inexistente → `NULL`, `search_path` fixo |
| `backend/src/database/valuation-triggers-hardening.int-spec.ts` | criar | testes da migration acima |
| `backend/src/modules/products/product-price-history.entity.ts` | criar | entidade (só leitura pela aplicação) |
| `backend/src/database/entities.ts` | modificar | registrar `ProductPriceHistory` |
| `backend/src/modules/losses/loss.entity.ts` | modificar | 3 colunas + tipo `LossValuationSource` |
| `backend/src/modules/losses/losses-valuation.ts` | criar | `resolveLossValuation`, `LOSS_REVENUE_SQL`, `LOSS_COST_SQL`, `lossValue` |
| `backend/src/modules/losses/losses-valuation.int-spec.ts` | criar | regras de escolha do preço (Postgres real) |
| `backend/src/modules/losses/losses.service.ts` | modificar | create/update gravam o valor; consultas e export usam o valor congelado |
| `backend/src/modules/losses/losses.service.spec.ts` | modificar | testes unitários de create/update |
| `backend/src/modules/losses/losses-f1-regression.int-spec.ts` | criar | regressão F1 ponta a ponta |
| `backend/src/modules/losses/losses-alerts.ts` | modificar | usa `lossValue` compartilhado; regra "preço zero" olha o valor congelado |
| `backend/src/modules/losses/losses-alerts.spec.ts` | criar | cobertura das regras que dependem de valor |
| `backend/src/modules/losses/losses-suspicious-patterns.ts` | modificar | usa o valor congelado |
| `backend/src/modules/losses/losses-suspicious-patterns.spec.ts` | modificar | `makeLoss` monta `unitPriceAtLoss` |
| `backend/src/common/tenant/tenant-context.middleware.ts` | modificar | define `app.current_user_id` |
| `backend/src/common/tenant/tenant-context.middleware.int-spec.ts` | modificar | teste da variável de sessão |
| `backend/src/modules/imports/imports.processor.ts` | modificar | `app.change_source = 'import'` |
| `backend/src/modules/imports/imports.processor.int-spec.ts` | criar | histórico da importação sai com `source = 'import'` |
| `backend/src/modules/products/products.service.ts` | modificar | `findPriceHistory` |
| `backend/src/modules/products/products.controller.ts` | modificar | `GET /products/:id/price-history` |
| `backend/src/modules/products/product-price-history.int-spec.ts` | criar | endpoint de histórico |

---

### Task 1: Migration `1700000013000-ValuationTriggersHardening`

**Por quê:** três achados menores da revisão da 1.2.2, dois dos quais viram bug de verdade nesta
sub-etapa: (a) quando o middleware (Task 5) passar a definir `app.current_user_id`, um token de usuário
já excluído faria o `INSERT` do trigger de histórico violar a FK `changedByUserId` → toda edição de preço
daria 500 (e os testes F16 do middleware, que usam um `sub` fictício, quebrariam); (b) o fallback de
`losses` sobrescreve os dois valores se só um vier `NULL`; (c) as funções de trigger dependem do
`search_path` de quem as chama.

**Files:**
- Create: `backend/src/database/migrations/1700000013000-ValuationTriggersHardening.ts`
- Create: `backend/src/database/valuation-triggers-hardening.int-spec.ts`

**Interfaces:**
- Consumes: tabelas/funções das migrations 11000 (`record_product_price_history`) e 12000
  (`losses_valuation_fallback`).
- Produces: as duas funções com o comportamento endurecido; nenhuma interface TypeScript. A Task 5 depende
  do item (a) para os testes F16 continuarem verdes.

- [ ] **Step 1: Criar o branch e confirmar o baseline**

```bash
cd /c/PROJETOS/SAAS && git checkout main && git checkout -b feat/cadastros-sp1-etapa-1-2-3
cd backend && npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```
Expected: 18 suítes/110 testes; 7 arquivos/32 testes; `tsc exit=0`.

- [ ] **Step 2: Escrever os testes (vão falhar)**

Create `backend/src/database/valuation-triggers-hardening.int-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

async function seedLossPrerequisites(companyId: string) {
  const userId = (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Func', $1, 'x', 'employee', $2) RETURNING id`,
      [`func-${companyId}@teste.local`, companyId],
    )
  )[0].id as string;
  const locationId = (
    await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId])
  )[0].id as string;
  const reasonId = (
    await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId])
  )[0].id as string;
  return { userId, locationId, reasonId };
}

describe('endurecimento dos triggers de valor (migration 1700000013000)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('usuário inexistente em app.current_user_id (token de usuário excluído) não quebra a edição de preço', async () => {
    const companyId = await seedCompany('Empresa Token Velho');
    const productId = await seedProduct({ companyId, barcode: '5001', unitPrice: 10, costPrice: 6 });

    await withTenant({ companyId, userId: randomUUID() }, (manager) =>
      manager.query(`UPDATE products SET "unitPrice" = 11 WHERE id = $1`, [productId]),
    );

    const rows = await adminQuery(
      `SELECT "unitPrice", "changedByUserId" FROM product_price_history WHERE "productId" = $1 ORDER BY seq`,
      [productId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ unitPrice: '11.00', changedByUserId: null });
  });

  it('fallback parcial: preço explícito é mantido, só o custo ausente vem do produto', async () => {
    const companyId = await seedCompany('Empresa Parcial');
    const productId = await seedProduct({ companyId, barcode: '5002', unitPrice: 25, costPrice: 15 });
    const { userId, locationId, reasonId } = await seedLossPrerequisites(companyId);

    const lossId = (
      await withTenant({ companyId }, (manager) =>
        manager.query(
          `INSERT INTO losses
             ("companyId", "clientGeneratedId", "productId", "reportedByUserId", "locationId", "reasonId",
              "occurredAt", "unitPriceAtLoss")
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now(), 99.99)
           RETURNING id`,
          [companyId, productId, userId, locationId, reasonId],
        ),
      )
    )[0].id;

    const [loss] = await adminQuery(
      `SELECT "unitPriceAtLoss", "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`,
      [lossId],
    );
    expect(loss).toMatchObject({ unitPriceAtLoss: '99.99', unitCostAtLoss: '15.00', valuationSource: 'fallback_current' });
  });

  it('as duas funções de trigger têm search_path fixo (não dependem de quem as chama)', async () => {
    const rows = await adminQuery(
      `SELECT proname, array_to_string(proconfig, ',') AS config
         FROM pg_proc
        WHERE proname IN ('record_product_price_history', 'losses_valuation_fallback')
        ORDER BY proname`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.config).toMatch(/search_path=public,\s*pg_temp/);
    }
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:int -- src/database/valuation-triggers-hardening.int-spec.ts`
Expected: FAIL nos 3 testes — o 1º com `violates foreign key constraint` (FK `changedByUserId`), o 2º com
`unitPriceAtLoss` = `'25.00'` em vez de `'99.99'`, o 3º com `config` `null`/vazio.

- [ ] **Step 4: Criar a migration**

Create `backend/src/database/migrations/1700000013000-ValuationTriggersHardening.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Endurece os dois triggers de valor da sub-etapa 1.2.2 (achados da revisão final dela):
 * - record_product_price_history: changedByUserId passa a ser procurado em "users" — um id que não
 *   existe (token de usuário já excluído) ou que a RLS esconde vira NULL, em vez de violar a FK e
 *   derrubar a edição de preço com 500.
 * - losses_valuation_fallback: completa só a coluna que veio NULL (COALESCE por coluna) — antes, um
 *   preço explícito com custo ausente perdia o preço explícito.
 * - Ambas com search_path fixo: nomes não qualificados não dependem do search_path de quem chama.
 * SECURITY INVOKER (padrão) de propósito: a RLS continua valendo dentro dos triggers.
 */
export class ValuationTriggersHardening1700000013000 implements MigrationInterface {
  name = 'ValuationTriggersHardening1700000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_product_price_history() RETURNS TRIGGER AS $$
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
            (SELECT u.id FROM users u
              WHERE u.id = NULLIF(current_setting('app.current_user_id', true), '')::uuid),
            COALESCE(NULLIF(current_setting('app.change_source', true), ''), 'manual')
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION losses_valuation_fallback() RETURNS TRIGGER AS $$
      DECLARE
        current_price numeric(12,2);
        current_cost  numeric(12,2);
      BEGIN
        IF NEW."unitPriceAtLoss" IS NULL OR NEW."unitCostAtLoss" IS NULL THEN
          SELECT "unitPrice", "costPrice" INTO current_price, current_cost
          FROM products WHERE id = NEW."productId";
          NEW."unitPriceAtLoss" := COALESCE(NEW."unitPriceAtLoss", current_price);
          NEW."unitCostAtLoss"  := COALESCE(NEW."unitCostAtLoss", current_cost);
          NEW."valuationSource" := 'fallback_current';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);
  }

  /** Restaura exatamente as versões das migrations 11000 e 12000. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_product_price_history() RETURNS TRIGGER AS $$
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
    await queryRunner.query(`ALTER FUNCTION record_product_price_history() RESET search_path`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION losses_valuation_fallback() RETURNS TRIGGER AS $$
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
    await queryRunner.query(`ALTER FUNCTION losses_valuation_fallback() RESET search_path`);
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:int -- src/database/valuation-triggers-hardening.int-spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 6: Checagem da tarefa e commit**

```bash
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/database/migrations/1700000013000-ValuationTriggersHardening.ts src/database/valuation-triggers-hardening.int-spec.ts
git commit -m "fix(backend): endurece os triggers de valor (usuário inexistente, fallback parcial, search_path)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: integração = baseline + 3 (8 arquivos / 35 testes); `tsc exit=0`.

---

### Task 2: Entidades e `resolveLossValuation`

**Files:**
- Create: `backend/src/modules/products/product-price-history.entity.ts`
- Modify: `backend/src/database/entities.ts`
- Modify: `backend/src/modules/losses/loss.entity.ts` (acrescentar colunas no fim da classe, antes de `occurredAt`)
- Create: `backend/src/modules/losses/losses-valuation.ts`
- Create: `backend/src/modules/losses/losses-valuation.int-spec.ts`

**Interfaces:**
- Consumes: tabela `product_price_history` (migration 11000).
- Produces (usados pelas Tasks 3, 4, 6):
  - `class ProductPriceHistory` (`product-price-history.entity.ts`) com `id: string`, `seq: string`,
    `companyId: string`, `productId: string`, `unitPrice: number`, `costPrice: number`, `validFrom: Date`,
    `changedByUserId: string | null`, `source: PriceChangeSource`, `createdAt: Date`; e
    `type PriceChangeSource = 'manual' | 'import' | 'bulk' | 'retro_fix' | 'erp' | 'approval' | 'backfill'`.
  - Em `loss.entity.ts`: `type LossValuationSource = 'snapshot' | 'backfill_current' | 'fallback_current' |
    'recalculated' | 'pending_product'`; `Loss.unitPriceAtLoss: number`, `Loss.unitCostAtLoss: number`,
    `Loss.valuationSource: LossValuationSource`.
  - Em `losses-valuation.ts`: `interface LossValuation { unitPrice: number; unitCost: number; source:
    LossValuationSource }`; `resolveLossValuation(manager: EntityManager, product: Pick<Product, 'id' |
    'unitPrice' | 'costPrice'>, occurredAt: Date): Promise<LossValuation>`; `LOSS_REVENUE_SQL: string`
    (`'loss.quantity * loss.unitPriceAtLoss'`); `LOSS_COST_SQL: string` (`'loss.quantity *
    loss.unitCostAtLoss'`); `lossValue(loss: Pick<Loss, 'quantity' | 'unitPriceAtLoss'>): number`.

**Decisão deste plano:** o spec (4.4) lista os testes de `resolveLossValuation` como unitários com
`manager` mockado. Aqui eles são de **integração**: "preço vigente na data", "mais antiga" e "desempate
por `seq`" são semântica de `ORDER BY`/`<=` no Postgres — com mock, o teste só conferiria os argumentos
passados ao `findOne`, não a escolha em si. A cobertura pedida pelo spec é a mesma.

- [ ] **Step 1: Escrever os testes (vão falhar: o módulo não existe)**

Create `backend/src/modules/losses/losses-valuation.int-spec.ts`:

```ts
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { Product } from '../products/product.entity';
import { resolveLossValuation } from './losses-valuation';

/** Substitui o histórico do produto por linhas com validFrom controlado (o trigger usa clock_timestamp()). */
async function setHistory(
  companyId: string,
  productId: string,
  rows: { validFrom: string; unitPrice: number; costPrice: number }[],
): Promise<void> {
  await adminQuery(`DELETE FROM product_price_history WHERE "productId" = $1`, [productId]);
  for (const row of rows) {
    await adminQuery(
      `INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", source)
       VALUES ($1, $2, $3, $4, $5, 'manual')`,
      [companyId, productId, row.unitPrice, row.costPrice, row.validFrom],
    );
  }
}

async function resolveAt(companyId: string, productId: string, occurredAt: string) {
  return withTenant({ companyId }, async (manager) => {
    const product = await manager.findOneOrFail(Product, { where: { id: productId } });
    return resolveLossValuation(manager, product, new Date(occurredAt));
  });
}

describe('resolveLossValuation — preço vigente em occurredAt', () => {
  let companyId: string;
  let productId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Valuation');
    productId = await seedProduct({ companyId, barcode: '6001', unitPrice: 99, costPrice: 88 });
    await setHistory(companyId, productId, [
      { validFrom: '2026-01-01T00:00:00Z', unitPrice: 10, costPrice: 5 },
      { validFrom: '2026-02-01T00:00:00Z', unitPrice: 20, costPrice: 12 },
      { validFrom: '2026-03-01T00:00:00Z', unitPrice: 30, costPrice: 18 },
    ]);
  });
  afterAll(() => closeTestConnections());

  it('usa a linha vigente na data (a última com validFrom <= occurredAt)', async () => {
    expect(await resolveAt(companyId, productId, '2026-02-15T12:00:00Z')).toEqual({
      unitPrice: 20,
      unitCost: 12,
      source: 'snapshot',
    });
  });

  it('occurredAt exatamente no validFrom já vale o preço novo', async () => {
    expect((await resolveAt(companyId, productId, '2026-03-01T00:00:00Z')).unitPrice).toBe(30);
  });

  it('occurredAt antes da primeira linha (relógio do aparelho atrasado) usa a MAIS ANTIGA, não o preço atual', async () => {
    expect(await resolveAt(companyId, productId, '2025-12-01T00:00:00Z')).toEqual({
      unitPrice: 10,
      unitCost: 5,
      source: 'snapshot',
    });
  });

  it('desempate por seq: duas linhas com o mesmo validFrom, vale a inserida por último', async () => {
    await adminQuery(
      `INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", source)
       VALUES ($1, $2, 40, 24, '2026-04-01T00:00:00Z', 'import'), ($1, $2, 41, 25, '2026-04-01T00:00:00Z', 'import')`,
      [companyId, productId],
    );
    expect((await resolveAt(companyId, productId, '2026-04-02T00:00:00Z')).unitPrice).toBe(41);
  });

  it('produto sem nenhuma linha de histórico usa o preço atual com fallback_current', async () => {
    await setHistory(companyId, productId, []);
    expect(await resolveAt(companyId, productId, '2026-02-15T12:00:00Z')).toEqual({
      unitPrice: 99,
      unitCost: 88,
      source: 'fallback_current',
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/losses/losses-valuation.int-spec.ts`
Expected: FAIL — `Cannot find module './losses-valuation'` (erro de compilação do ts-jest).

- [ ] **Step 3: Criar a entidade `ProductPriceHistory`**

Create `backend/src/modules/products/product-price-history.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type PriceChangeSource = 'manual' | 'import' | 'bulk' | 'retro_fix' | 'erp' | 'approval' | 'backfill';

/**
 * Histórico de preço/custo (migration 1700000011000). Append-only e alimentado SÓ pelo trigger
 * record_product_price_history em "products" — a aplicação apenas lê. Por isso todas as colunas são
 * insert: false / update: false: um save() acidental não grava nada aqui.
 */
@Entity('product_price_history')
export class ProductPriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // bigint chega como string pelo driver pg. Desempate de linhas com o mesmo validFrom.
  @Column({ type: 'bigint', insert: false, update: false })
  seq: string;

  @Column({ type: 'uuid', insert: false, update: false })
  companyId: string;

  @Column({ type: 'uuid', insert: false, update: false })
  productId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, insert: false, update: false })
  unitPrice: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, insert: false, update: false })
  costPrice: number;

  @Column({ type: 'timestamptz', insert: false, update: false })
  validFrom: Date;

  @Column({ type: 'uuid', nullable: true, insert: false, update: false })
  changedByUserId: string | null;

  @Column({ type: 'varchar', length: 20, insert: false, update: false })
  source: PriceChangeSource;

  @CreateDateColumn({ type: 'timestamptz', insert: false, update: false })
  createdAt: Date;
}
```

- [ ] **Step 4: Registrar a entidade**

Modify `backend/src/database/entities.ts` — acrescentar o import e o item no fim da lista:

```ts
import { ProductPriceHistory } from '../modules/products/product-price-history.entity';
```
```ts
export const ENTITIES = [
  Company,
  User,
  Product,
  Loss,
  ImportJob,
  LossReason,
  LossLocation,
  CompanyMonthlyRevenue,
  ProductPriceHistory,
];
```

- [ ] **Step 5: Acrescentar as colunas em `Loss`**

Modify `backend/src/modules/losses/loss.entity.ts` — depois do `enum LossSource` (antes de `@Entity`):

```ts
// Origem do valor congelado (migration 1700000012000, CHECK chk_losses_valuation_source). varchar +
// CHECK em vez de enum do Postgres (R4 do spec do SP1): os SPs 5 e 6 vão acrescentar valores.
export type LossValuationSource =
  | 'snapshot'
  | 'backfill_current'
  | 'fallback_current'
  | 'recalculated'
  | 'pending_product';
```

e, dentro da classe, imediatamente antes do comentário `// Momento em que a perda ocorreu…`:

```ts
  // Valor congelado (SP1, sub-etapas 1.2.2/1.2.3): preço e custo vigentes em occurredAt, gravados por
  // LossesService via resolveLossValuation. É a base de TODO cálculo de prejuízo — nunca o preço atual
  // do produto (F1: mudar o preço reescrevia o valor de perdas antigas).
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  unitPriceAtLoss: number;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  unitCostAtLoss: number;

  @Column({ type: 'varchar', length: 20, default: 'snapshot' })
  valuationSource: LossValuationSource;
```

- [ ] **Step 6: Criar `losses-valuation.ts`**

Create `backend/src/modules/losses/losses-valuation.ts`:

```ts
import { EntityManager, LessThanOrEqual } from 'typeorm';
import { ProductPriceHistory } from '../products/product-price-history.entity';
import { Product } from '../products/product.entity';
import { Loss, LossValuationSource } from './loss.entity';

export interface LossValuation {
  unitPrice: number;
  unitCost: number;
  source: LossValuationSource;
}

/**
 * Preço/custo vigentes em `occurredAt` (spec do SP1, seção 4.2):
 * 1. a última linha do histórico com validFrom <= occurredAt (desempate por seq);
 * 2. senão, a MAIS ANTIGA — occurredAt anterior à 1ª linha acontece quando o relógio do aparelho está
 *    atrasado em relação à criação do produto; o preço mais antigo é o melhor palpite, não o atual;
 * 3. senão (produto sem histórico — não deveria ocorrer depois do backfill da 1.2.2), o preço atual,
 *    marcado fallback_current para ficar visível e auditável.
 * O manager tem de ser o da requisição (RLS ativa): o histórico de outra empresa nunca é enxergado.
 */
export async function resolveLossValuation(
  manager: EntityManager,
  product: Pick<Product, 'id' | 'unitPrice' | 'costPrice'>,
  occurredAt: Date,
): Promise<LossValuation> {
  const inEffect = await manager.findOne(ProductPriceHistory, {
    where: { productId: product.id, validFrom: LessThanOrEqual(occurredAt) },
    order: { validFrom: 'DESC', seq: 'DESC' },
  });
  const row =
    inEffect ??
    (await manager.findOne(ProductPriceHistory, {
      where: { productId: product.id },
      order: { validFrom: 'ASC', seq: 'ASC' },
    }));

  if (row) {
    return { unitPrice: Number(row.unitPrice), unitCost: Number(row.costPrice), source: 'snapshot' };
  }
  return { unitPrice: Number(product.unitPrice), unitCost: Number(product.costPrice), source: 'fallback_current' };
}

/** Prejuízo de venda de uma perda, para consultas com o alias `loss` (TypeORM traduz as propriedades). */
export const LOSS_REVENUE_SQL = 'loss.quantity * loss.unitPriceAtLoss';

/** Prejuízo de custo de uma perda, mesmo contrato de LOSS_REVENUE_SQL. */
export const LOSS_COST_SQL = 'loss.quantity * loss.unitCostAtLoss';

/** Mesmo cálculo de LOSS_REVENUE_SQL, para as funções puras (alertas, padrões suspeitos). */
export function lossValue(loss: Pick<Loss, 'quantity' | 'unitPriceAtLoss'>): number {
  return Number(loss.quantity) * Number(loss.unitPriceAtLoss ?? 0);
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm run test:int -- src/modules/losses/losses-valuation.int-spec.ts`
Expected: PASS — 5 testes.

- [ ] **Step 8: Checagem da tarefa e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/products/product-price-history.entity.ts src/database/entities.ts src/modules/losses/loss.entity.ts src/modules/losses/losses-valuation.ts src/modules/losses/losses-valuation.int-spec.ts
git commit -m "feat(backend): entidade do histórico de preço e resolveLossValuation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: unitário inalterado (110); integração = baseline + 8 (9 arquivos / 40 testes); `tsc exit=0`.
(Nenhum escritor grava as colunas novas ainda: o `create` atual omite os campos `undefined` no INSERT e o
trigger de segurança preenche — por isso nada quebra entre esta tarefa e a próxima.)

---

### Task 3: `LossesService.create` e `update` gravam o valor congelado

**Files:**
- Modify: `backend/src/modules/losses/losses.service.ts:28-95`
- Test: `backend/src/modules/losses/losses.service.spec.ts`

**Interfaces:**
- Consumes: `resolveLossValuation`, `LossValuation` (Task 2); `Loss.unitPriceAtLoss/unitCostAtLoss/valuationSource` (Task 2).
- Produces: perdas criadas/editadas pela aplicação com `valuationSource = 'snapshot'` (ou
  `'fallback_current'` se o produto não tiver histórico). A Task 4 (regressão F1) depende disso.

**Decisão deste plano:** ao recalcular no `update`, a origem é a que `resolveLossValuation` devolver
(`snapshot`/`fallback_current`) — `'recalculated'` fica reservado para a correção retroativa de preço do
SP2, que recalcula perdas por causa de uma mudança de PREÇO, não de uma edição da perda.

- [ ] **Step 1: Escrever os testes unitários (vão falhar)**

Modify `backend/src/modules/losses/losses.service.spec.ts` — acrescentar ao fim do arquivo:

```ts
describe('LossesService — valor congelado (SP1, sub-etapa 1.2.3)', () => {
  const OCCURRED_AT = '2026-09-10T15:00:00.000Z';

  it('create grava o preço vigente em occurredAt (não o preço atual do produto)', async () => {
    const manager = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'loss-1', ...data })),
    };
    // Ordem: loss existente (null), produto, motivo, local, empresa, linha vigente do histórico.
    manager.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: PRODUCT_ID, name: 'Arroz 5kg', unitPrice: '30.00', costPrice: '20.00' })
      .mockResolvedValueOnce({ id: REASON_ID })
      .mockResolvedValueOnce({ id: LOCATION_ID })
      .mockResolvedValueOnce({ id: COMPANY_ID, lossVerificationEnabled: false })
      .mockResolvedValueOnce({ unitPrice: '25.00', costPrice: '15.00' });

    const result = await runWithTenantContext(manager, () =>
      new LossesService().create({
        clientGeneratedId: CLIENT_GENERATED_ID,
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        reasonId: REASON_ID,
        occurredAt: OCCURRED_AT,
      }),
    );

    expect(result).toMatchObject({ unitPriceAtLoss: 25, unitCostAtLoss: 15, valuationSource: 'snapshot' });
    // A consulta ao histórico usou occurredAt — não "agora".
    const historyQuery = manager.findOne.mock.calls[5][1];
    expect(historyQuery.where.validFrom.value).toEqual(new Date(OCCURRED_AT));
  });

  it('update que muda só quantidade/descrição NÃO recalcula o valor congelado', async () => {
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      quantity: 1,
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(loss),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { quantity: 3, description: 'Corrigido' }),
    );

    expect(manager.findOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ quantity: 3, unitPriceAtLoss: 25, unitCostAtLoss: 15 });
  });

  it('update com os MESMOS productId/occurredAt (formulário reenviando tudo) NÃO recalcula', async () => {
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        .mockResolvedValueOnce({ id: PRODUCT_ID, unitPrice: '99.00', costPrice: '88.00' }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { productId: PRODUCT_ID, occurredAt: OCCURRED_AT }),
    );

    // 1ª chamada: a perda; 2ª: validação do produto informado. Nenhuma consulta ao histórico.
    expect(manager.findOne).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ unitPriceAtLoss: 25, unitCostAtLoss: 15, valuationSource: 'snapshot' });
  });

  it('update que muda occurredAt recalcula com o preço vigente na nova data', async () => {
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        // produto (carregado para o cálculo), depois a linha vigente na nova data
        .mockResolvedValueOnce({ id: PRODUCT_ID, unitPrice: '99.00', costPrice: '88.00' })
        .mockResolvedValueOnce({ unitPrice: '18.00', costPrice: '9.00' }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { occurredAt: '2026-08-01T10:00:00.000Z' }),
    );

    expect(result).toMatchObject({ unitPriceAtLoss: 18, unitCostAtLoss: 9, valuationSource: 'snapshot' });
  });

  it('update que muda o produto recalcula com o histórico do produto novo', async () => {
    const OTHER_PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440009';
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        .mockResolvedValueOnce({ id: OTHER_PRODUCT_ID, unitPrice: '7.00', costPrice: '3.00' })
        .mockResolvedValueOnce({ unitPrice: '6.50', costPrice: '2.50' }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { productId: OTHER_PRODUCT_ID }),
    );

    expect(result).toMatchObject({ productId: OTHER_PRODUCT_ID, unitPriceAtLoss: 6.5, unitCostAtLoss: 2.5 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/losses/losses.service.spec.ts`
Expected: FAIL — os testes de `create`, "muda occurredAt" e "muda o produto" falham (`unitPriceAtLoss`
ausente / 25 em vez do recalculado); os dois de "não recalcula" podem passar já agora (o código atual
não mexe nos campos) — eles protegem contra a implementação recalcular demais, e têm de continuar
passando depois do Step 3.

- [ ] **Step 3: Implementar**

Modify `backend/src/modules/losses/losses.service.ts`:

Import (junto dos outros imports locais):
```ts
import { resolveLossValuation } from './losses-valuation';
```

Em `create`, substituir o bloco a partir de `const company = …` até o `return manager.save(loss);` por:
```ts
    const company = await manager.findOne(Company, { where: { id: companyId! } });

    const occurredAt = new Date(dto.occurredAt);
    // Preço vigente QUANDO a perda ocorreu — uma perda offline sincronizada dias depois, com o preço
    // alterado no meio, vale o preço daquele dia (F1).
    const valuation = await resolveLossValuation(manager, product, occurredAt);

    const loss = manager.create(Loss, {
      companyId: companyId!,
      clientGeneratedId: dto.clientGeneratedId,
      productId: dto.productId,
      reportedByUserId: userId,
      quantity: dto.quantity ?? 1,
      locationId: dto.locationId,
      reasonId: dto.reasonId,
      description: dto.description || null,
      imageUrl: dto.imageUrl ?? null,
      occurredAt,
      source: dto.source ?? null,
      requiresVerification: company?.lossVerificationEnabled ?? false,
      unitPriceAtLoss: valuation.unitPrice,
      unitCostAtLoss: valuation.unitCost,
      valuationSource: valuation.source,
    });
    return manager.save(loss);
```

Substituir o método `update` inteiro por:
```ts
  async update(id: string, dto: UpdateLossDto): Promise<Loss> {
    const manager = getTenantManager();
    const loss = await manager.findOne(Loss, { where: { id } });
    if (!loss) throw new NotFoundException('Perda não encontrada.');

    const previousProductId = loss.productId;
    const previousOccurredAt = new Date(loss.occurredAt).getTime();
    let product: Product | null = null;

    if (dto.productId !== undefined) {
      product = await manager.findOne(Product, { where: { id: dto.productId } });
      if (!product) throw new NotFoundException('Produto informado não existe para esta empresa.');
      loss.productId = dto.productId;
    }
    if (dto.reasonId !== undefined) {
      const reason = await manager.findOne(LossReason, { where: { id: dto.reasonId } });
      if (!reason) throw new NotFoundException('Motivo informado não existe para esta empresa.');
      loss.reasonId = dto.reasonId;
    }
    if (dto.locationId !== undefined) {
      const location = await manager.findOne(LossLocation, { where: { id: dto.locationId } });
      if (!location) throw new NotFoundException('Local informado não existe para esta empresa.');
      loss.locationId = dto.locationId;
    }
    if (dto.quantity !== undefined) loss.quantity = dto.quantity;
    if (dto.description !== undefined) loss.description = dto.description || null;
    if (dto.occurredAt !== undefined) loss.occurredAt = new Date(dto.occurredAt);

    // O valor congelado só muda se mudar O QUE foi perdido ou QUANDO (spec 4.2). Compara valores, não
    // presença no DTO: o formulário do painel reenvia todos os campos, inclusive os inalterados.
    const valuationInputsChanged =
      loss.productId !== previousProductId || new Date(loss.occurredAt).getTime() !== previousOccurredAt;
    if (valuationInputsChanged) {
      product ??= await manager.findOne(Product, { where: { id: loss.productId } });
      if (!product) throw new NotFoundException('Produto informado não existe para esta empresa.');
      const valuation = await resolveLossValuation(manager, product, loss.occurredAt);
      loss.unitPriceAtLoss = valuation.unitPrice;
      loss.unitCostAtLoss = valuation.unitCost;
      loss.valuationSource = valuation.source;
    }

    return manager.save(loss);
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/losses/losses.service.spec.ts`
Expected: PASS — todos os testes do arquivo (os 12 existentes + 5 novos).

- [ ] **Step 5: Checagem da tarefa e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/losses/losses.service.ts src/modules/losses/losses.service.spec.ts
git commit -m "feat(backend): perdas gravam o preço vigente em occurredAt (create/update)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: unitário = baseline + 5 (18 suítes / 115); integração inalterada desde a Task 2 (40); `tsc exit=0`.

---

### Task 4: Relatórios e export passam a usar o valor congelado (regressão F1)

**Files:**
- Modify: `backend/src/modules/losses/losses.service.ts` (métodos `reportByProduct`, `sumRange`,
  `reportByPeriod`, `reportByReason`, `reportByLocation`, `exportToXlsx`, `topProductIdsInRange`)
- Create: `backend/src/modules/losses/losses-f1-regression.int-spec.ts`

**Interfaces:**
- Consumes: `LOSS_REVENUE_SQL`, `LOSS_COST_SQL` (Task 2); perdas com valor congelado gravado (Task 3).
- Produces: nenhuma interface nova; formatos de resposta inalterados.

- [ ] **Step 1: Escrever o teste de regressão F1 (vai falhar)**

Create `backend/src/modules/losses/losses-f1-regression.int-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { ProductsService } from '../products/products.service';
import { UserRole } from '../users/user.entity';
import { LossesService } from './losses.service';

/**
 * F1 (desenho mestre): mudar o preço do produto reescrevia o valor de TODAS as perdas antigas em todo
 * relatório. Registra uma perda de 2 unidades a R$ 25,00, muda o preço para R$ 100,00 e confere que o
 * prejuízo continua R$ 50,00 no resumo do mês, no relatório por produto, nas composições e no xlsx.
 */
describe('regressão F1 — mudar o preço não reescreve perdas antigas', () => {
  let companyId: string;
  let productId: string;
  let managerId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa F1');
    productId = await seedProduct({ companyId, barcode: '7001', unitPrice: 25, costPrice: 15 });
    managerId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Gerente F1', 'gerente-f1@teste.local', 'x', 'manager', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const locationId = (
      await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId])
    )[0].id;
    const reasonId = (
      await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId])
    )[0].id;

    const ctx = { companyId, userId: managerId, role: UserRole.MANAGER };
    await withTenant(ctx, () =>
      new LossesService().create({
        clientGeneratedId: randomUUID(),
        productId,
        locationId,
        reasonId,
        quantity: 2,
        occurredAt: new Date().toISOString(),
      }),
    );
    await withTenant(ctx, () => new ProductsService().update(productId, { unitPrice: 100, costPrice: 60 }));
  });
  afterAll(() => closeTestConnections());

  const ctx = () => ({ companyId, userId: managerId, role: UserRole.MANAGER });

  it('reportSummary mantém o prejuízo do mês', async () => {
    const summary = await withTenant(ctx(), () => new LossesService().reportSummary());
    expect(summary.currentMonth.totalFinancialLoss).toBe(50);
    expect(summary.currentMonth.totalCostLoss).toBe(30);
  });

  it('reportByProduct mantém o prejuízo do produto', async () => {
    const [row] = await withTenant(ctx(), () => new LossesService().reportByProduct({}));
    expect(Number(row.totalFinancialLoss)).toBe(50);
    expect(Number(row.totalCostLoss)).toBe(30);
  });

  it('reportByReason, reportByLocation e reportByPeriod mantêm o prejuízo', async () => {
    const service = new LossesService();
    const [byReason] = await withTenant(ctx(), () => service.reportByReason({}));
    const [byLocation] = await withTenant(ctx(), () => service.reportByLocation({}));
    const [byPeriod] = await withTenant(ctx(), () => service.reportByPeriod({}));
    expect(Number(byReason.totalFinancialLoss)).toBe(50);
    expect(Number(byLocation.totalFinancialLoss)).toBe(50);
    expect(Number(byPeriod.totalFinancialLoss)).toBe(50);
  });

  it('o export xlsx mostra o preço e o prejuízo da época da perda', async () => {
    const buffer = await withTenant(ctx(), () => new LossesService().exportToXlsx({}));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const row = workbook.worksheets[0].getRow(2);
    expect(row.getCell(5).value).toBe(25); // Preço unitário
    expect(row.getCell(6).value).toBe(50); // Prejuízo estimado
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/losses/losses-f1-regression.int-spec.ts`
Expected: FAIL nos 4 testes — os relatórios devolvem **200** (2 × R$ 100, o preço novo) em vez de 50, o
custo 120 em vez de 30, e o xlsx 100/200 em vez de 25/50. (Se falhar por outro motivo — ex.: erro de
tipo em `ProductsService.update`/`reportByProduct({})` — é problema do teste, corrija antes de seguir.)

- [ ] **Step 3: Trocar a base de cálculo**

Modify `backend/src/modules/losses/losses.service.ts`:

Import:
```ts
import { LOSS_COST_SQL, LOSS_REVENUE_SQL, resolveLossValuation } from './losses-valuation';
```
(substitui o import só de `resolveLossValuation` da Task 3).

`reportByProduct` — trocar as duas linhas de soma (o `innerJoin` com `product` fica: ele dá o nome):
```ts
      .addSelect(`SUM(${LOSS_REVENUE_SQL})`, 'totalFinancialLoss')
      .addSelect(`SUM(${LOSS_COST_SQL})`, 'totalCostLoss')
```

`sumRange` — remover o `.innerJoin(Product, …)` (não é mais usado) e trocar as somas:
```ts
    const raw = await manager
      .createQueryBuilder(Loss, 'loss')
      .select('COALESCE(SUM(loss.quantity), 0)', 'totalQuantity')
      .addSelect(`COALESCE(SUM(${LOSS_REVENUE_SQL}), 0)`, 'totalFinancialLoss')
      .addSelect(`COALESCE(SUM(${LOSS_COST_SQL}), 0)`, 'totalCostLoss')
      .where('loss.occurredAt >= :from AND loss.occurredAt < :to', { from, to })
      .getRawOne<{ totalQuantity: string; totalFinancialLoss: string; totalCostLoss: string }>();
```

`reportByPeriod`, `reportByReason`, `reportByLocation` — remover o `.innerJoin(Product, 'product', …)` de
cada um e trocar a soma:
```ts
      .addSelect(`SUM(${LOSS_REVENUE_SQL})`, 'totalFinancialLoss')
```

`topProductIdsInRange` — o `innerJoin` com `product` fica (dá id/nome); trocar a soma:
```ts
      .addSelect(`SUM(${LOSS_REVENUE_SQL})`, 'total')
```

`exportToXlsx` — dentro do `for`, trocar a primeira linha:
```ts
      const unitPrice = Number(loss.unitPriceAtLoss);
```

Atualizar o JSDoc de `reportByProduct` ("…prejuízo financeiro estimado (quantidade x preço unitário do
produto no momento da consulta)") para: `…prejuízo financeiro (quantidade x preço congelado da perda —
o vigente em occurredAt, não o preço atual do produto).`

- [ ] **Step 4: Rodar e ver passar; conferir que não sobrou uso do preço atual**

```bash
npm run test:int -- src/modules/losses/losses-f1-regression.int-spec.ts
grep -n "product.unitPrice\|product.costPrice\|product?.unitPrice" src/modules/losses/losses.service.ts
```
Expected: PASS — 4 testes; o `grep` não imprime nada.

- [ ] **Step 5: Checagem da tarefa e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/losses/losses.service.ts src/modules/losses/losses-f1-regression.int-spec.ts
git commit -m "fix(backend): relatórios e export usam o valor congelado da perda (F1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: unitário inalterado desde a Task 3 (115); integração = +4 (10 arquivos / 44); `tsc exit=0`.

---

### Task 5: Alertas e padrões suspeitos usam o valor congelado

**Files:**
- Modify: `backend/src/modules/losses/losses-alerts.ts:72-74` (remover `lossValue` local), `:357-363` (regra de preço zero)
- Create: `backend/src/modules/losses/losses-alerts.spec.ts`
- Modify: `backend/src/modules/losses/losses-suspicious-patterns.ts:55-57`, `:95-97`, `:136-143`
- Modify: `backend/src/modules/losses/losses-suspicious-patterns.spec.ts` (`makeLoss`)

**Interfaces:**
- Consumes: `lossValue` (Task 2), `Loss.unitPriceAtLoss` (Task 2).
- Produces: nada novo; `LossAlert`/`SuspiciousPatternEntry` inalterados.

- [ ] **Step 1: Reescrever o `makeLoss` dos padrões suspeitos (os testes existentes vão falhar)**

Modify `backend/src/modules/losses/losses-suspicious-patterns.spec.ts` — no objeto devolvido por
`makeLoss`, trocar a linha `product: { id: productId, name: productName, unitPrice } as Loss['product'],`
por:

```ts
    // O preço do CADASTRO hoje é diferente de propósito (0): o cálculo tem de usar o valor congelado da
    // perda (unitPriceAtLoss), nunca o preço atual do produto (F1).
    product: { id: productId, name: productName, unitPrice: 0 } as Loss['product'],
    unitPriceAtLoss: unitPrice,
    unitCostAtLoss: 0,
    valuationSource: 'snapshot',
```

- [ ] **Step 2: Criar o spec dos alertas (vai falhar)**

Create `backend/src/modules/losses/losses-alerts.spec.ts`:

```ts
import { Loss } from './loss.entity';
import { AlertsInput, computeLossAlerts } from './losses-alerts';

let idCounter = 0;

/** Perda mínima para as regras de valor. `catalogPrice` = preço do cadastro HOJE (diferente de propósito). */
function makeLoss(overrides: { productId: string; productName: string; unitPriceAtLoss: number; catalogPrice: number }): Loss {
  idCounter += 1;
  return {
    id: `loss-${idCounter}`,
    companyId: 'company-1',
    productId: overrides.productId,
    product: { id: overrides.productId, name: overrides.productName, unitPrice: overrides.catalogPrice, isActive: true },
    reportedByUserId: 'emp-1',
    reportedBy: { id: 'emp-1', name: 'Funcionário' },
    quantity: 1,
    locationId: 'loc-1',
    location: { id: 'loc-1', name: 'Local 1' },
    reasonId: 'reason-1',
    reason: { id: 'reason-1', name: 'Quebra' },
    description: 'Descrição detalhada o suficiente',
    imageUrl: 'https://example.com/foto.jpg',
    unitPriceAtLoss: overrides.unitPriceAtLoss,
    unitCostAtLoss: 0,
    valuationSource: 'snapshot',
    occurredAt: new Date(),
    createdAt: new Date(),
  } as unknown as Loss;
}

function input(currentLosses: Loss[]): AlertsInput {
  return {
    currentLosses,
    previousLosses: [],
    monthSummary: {
      currentMonth: { totalQuantity: 0, totalFinancialLoss: 0 },
      previousMonth: { totalQuantity: 0, totalFinancialLoss: 0 },
      financialVariationPercent: null,
    },
    activeEmployeeCount: 0,
    recentTop3ByMonth: [[], [], []],
    now: new Date(),
  };
}

describe('computeLossAlerts — regras de valor usam o valor congelado da perda', () => {
  it('concentração por produto pesa pelo valor da época, não pelo preço atual do cadastro', () => {
    const losses = [
      // A valia 100 quando foi perdido (hoje custa 1); B valia 1 (hoje custa 100).
      makeLoss({ productId: 'A', productName: 'Produto A', unitPriceAtLoss: 100, catalogPrice: 1 }),
      makeLoss({ productId: 'B', productName: 'Produto B', unitPriceAtLoss: 1, catalogPrice: 100 }),
    ];
    const alert = computeLossAlerts(input(losses)).find((a) => a.id === 'product_concentration');
    expect(alert?.description).toContain('"Produto A"');
  });

  it('preço zero: dispara quando a perda foi registrada com valor zero, mesmo que o cadastro já tenha preço', () => {
    const losses = [makeLoss({ productId: 'Z', productName: 'Sem Preço', unitPriceAtLoss: 0, catalogPrice: 50 })];
    expect(computeLossAlerts(input(losses)).some((a) => a.id === 'zero_price_product')).toBe(true);
  });

  it('preço zero: NÃO dispara quando a perda tem valor, mesmo que o cadastro esteja zerado hoje', () => {
    const losses = [makeLoss({ productId: 'P', productName: 'Com Preço', unitPriceAtLoss: 10, catalogPrice: 0 })];
    expect(computeLossAlerts(input(losses)).some((a) => a.id === 'zero_price_product')).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/losses/losses-alerts.spec.ts src/modules/losses/losses-suspicious-patterns.spec.ts`
Expected: FAIL — em `losses-alerts.spec.ts` os 3 testes (a concentração aponta "Produto B"; o alerta de
preço zero segue o cadastro); em `losses-suspicious-patterns.spec.ts` os testes que dependem de valor
(ex.: "sinal 1: concentração de valor no funcionário") falham porque o preço do cadastro agora é 0.

- [ ] **Step 4: Implementar**

Modify `backend/src/modules/losses/losses-alerts.ts`:
- acrescentar `import { lossValue } from './losses-valuation';` depois do import de `Loss`;
- apagar a função local `lossValue` (linhas 72-74);
- em `checkZeroPriceProduct`, trocar a condição:
```ts
    if (loss.product && Number(loss.unitPriceAtLoss) === 0) {
```
e a descrição do alerta para refletir o valor da perda:
```ts
    description: `${zeroPriceProducts.size} produto(s) com perdas registradas a preço zero (${names}) estão subestimando o prejuízo real — corrija o preço unitário no cadastro.`,
```

Modify `backend/src/modules/losses/losses-suspicious-patterns.ts`:
- acrescentar `import { lossValue } from './losses-valuation';` depois do import de `Loss`;
- apagar a função local `lossValue` (linhas 55-57);
- em `computeHighValueThreshold`, trocar a primeira linha por:
```ts
  const prices = [...new Set(losses.map((l) => Number(l.unitPriceAtLoss)))].sort((a, b) => a - b);
```
- no bloco "2. Produto de alto valor recorrente", trocar `price: Number(loss.product.unitPrice),` por:
```ts
        price: Number(loss.unitPriceAtLoss),
```

- [ ] **Step 5: Rodar e ver passar; conferir que não sobrou uso do preço atual**

```bash
npx jest src/modules/losses/losses-alerts.spec.ts src/modules/losses/losses-suspicious-patterns.spec.ts
grep -rn "product.unitPrice\|product?.unitPrice\|product!.unitPrice\|product.costPrice" src/modules/losses --include=*.ts | grep -v "\.spec\.ts"
```
Expected: PASS em ambos os arquivos; o `grep` não imprime nada.

- [ ] **Step 6: Checagem da tarefa e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/losses/losses-alerts.ts src/modules/losses/losses-alerts.spec.ts src/modules/losses/losses-suspicious-patterns.ts src/modules/losses/losses-suspicious-patterns.spec.ts
git commit -m "fix(backend): alertas e padrões suspeitos usam o valor congelado da perda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: unitário = +1 suíte / +3 testes (19 suítes / 118); `tsc exit=0`.

---

### Task 6: Contexto do histórico — usuário no middleware e origem na importação

**Files:**
- Modify: `backend/src/common/tenant/tenant-context.middleware.ts:48-56`
- Modify: `backend/src/common/tenant/tenant-context.middleware.int-spec.ts`
- Modify: `backend/src/modules/imports/imports.processor.ts:37-38`
- Create: `backend/src/modules/imports/imports.processor.int-spec.ts`

**Interfaces:**
- Consumes: trigger endurecido da Task 1 (usuário inexistente → `NULL`) — sem ele, os testes F16 deste
  mesmo arquivo, que usam um `sub` fictício e inserem produtos, quebrariam por FK.
- Produces: `app.current_user_id` definido em toda requisição autenticada; `app.change_source = 'import'`
  na transação da importação.

- [ ] **Step 1: Escrever o teste do middleware (vai falhar)**

Modify `backend/src/common/tenant/tenant-context.middleware.int-spec.ts`:

Em `startServer`, depois da rota `/double`, acrescentar:
```ts
  app.post('/user-setting', (_req, res) => {
    void getTenantManager()
      .query(`SELECT current_setting('app.current_user_id', true) AS value`)
      .then((rows: { value: string | null }[]) => res.status(200).json({ value: rows[0].value }));
  });
```

No fim do arquivo, um `describe` novo:
```ts
describe('TenantContextMiddleware — app.current_user_id para o histórico de preço', () => {
  const USER_ID = '00000000-0000-4000-8000-000000000002';
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer(await appDataSource());
  });
  afterAll(async () => {
    await server.close();
    await closeTestConnections();
  });

  it('define app.current_user_id com o sub do token', async () => {
    await truncateAll();
    const companyId = await seedCompany('Empresa Usuário');
    const token = await new JwtService({ secret: JWT_SECRET }).signAsync({
      sub: USER_ID,
      role: UserRole.MANAGER,
      companyId,
    });

    const { status, body } = await post(server.baseUrl, '/user-setting', token);

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ value: USER_ID });
  });
});
```

- [ ] **Step 2: Escrever o teste da importação (vai falhar)**

Create `backend/src/modules/imports/imports.processor.int-spec.ts`:

```ts
import { Job } from 'bullmq';
import * as ExcelJS from 'exceljs';
import {
  adminQuery,
  appDataSource,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
} from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { ProductImportJobData } from './imports.service';
import { ImportsProcessor } from './imports.processor';

async function spreadsheet(rows: [string, string, number][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Produtos');
  sheet.addRow(['Codigo', 'Nome', 'Preco']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('ImportsProcessor — histórico de preço registra a origem "import"', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('mudança de preço feita pela importação entra no histórico com source = import', async () => {
    const companyId = await seedCompany('Empresa Importação');
    const productId = await seedProduct({ companyId, barcode: '8001', unitPrice: 10 });
    const importJobId = (
      await adminQuery(
        `INSERT INTO import_jobs ("companyId", "fileName", "storageKey") VALUES ($1, 'p.xlsx', 'k') RETURNING id`,
        [companyId],
      )
    )[0].id;
    const buffer = await spreadsheet([['8001', 'Produto Importado', 15]]);
    const storage = { downloadBuffer: async () => buffer } as unknown as StorageService;
    const processor = new ImportsProcessor(await appDataSource(), storage);

    await processor.process({
      data: {
        importJobId,
        companyId,
        storageKey: 'k',
        mapping: { barcodeColumn: 'Codigo', nameColumn: 'Nome', unitPriceColumn: 'Preco' },
      },
    } as Job<ProductImportJobData>);

    const [job] = await adminQuery(`SELECT status, "successCount" FROM import_jobs WHERE id = $1`, [importJobId]);
    expect(job).toMatchObject({ status: 'completed', successCount: 1 });
    const history = await adminQuery(
      `SELECT "unitPrice", source FROM product_price_history WHERE "productId" = $1 ORDER BY seq`,
      [productId],
    );
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ unitPrice: '15.00', source: 'import' });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:int -- src/common/tenant/tenant-context.middleware.int-spec.ts src/modules/imports/imports.processor.int-spec.ts`
Expected: FAIL em 2 testes — o do middleware recebe `{ value: '' }` (ou `null`) em vez do id; o da
importação recebe `source: 'manual'`. Os testes F16 existentes continuam passando.

- [ ] **Step 4: Implementar**

Modify `backend/src/common/tenant/tenant-context.middleware.ts` — dentro do `try`, logo depois do `if
(payload?.companyId) { … }`:
```ts
      if (payload?.sub) {
        // Quem está agindo — lido pelo trigger do histórico de preço (changedByUserId). Um id que não
        // existe mais (token de usuário excluído) vira NULL lá dentro (migration 1700000013000).
        await queryRunner.query(`SELECT set_config('app.current_user_id', $1, true)`, [payload.sub]);
      }
```

Modify `backend/src/modules/imports/imports.processor.ts` — logo depois do `set_config` do
`app.current_company_id`:
```ts
      // Origem das mudanças de preço desta transação — o trigger do histórico registra 'import'.
      await manager.query(`SELECT set_config('app.change_source', 'import', true)`);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:int -- src/common/tenant/tenant-context.middleware.int-spec.ts src/modules/imports/imports.processor.int-spec.ts`
Expected: PASS — todos os testes dos dois arquivos (F16 incluídos).

- [ ] **Step 6: Checagem da tarefa e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/common/tenant/tenant-context.middleware.ts src/common/tenant/tenant-context.middleware.int-spec.ts src/modules/imports/imports.processor.ts src/modules/imports/imports.processor.int-spec.ts
git commit -m "feat(backend): histórico de preço registra quem alterou e a origem da importação" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: unitário inalterado (118); integração = +2 testes, +1 arquivo (11 arquivos / 46); `tsc exit=0`.

---

### Task 7: Endpoint `GET /products/:id/price-history` e registro do andamento

**Files:**
- Modify: `backend/src/modules/products/products.service.ts`
- Modify: `backend/src/modules/products/products.controller.ts`
- Create: `backend/src/modules/products/product-price-history.int-spec.ts`
- Modify: `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` (seção 4, resultados da 1.2.3)
- Modify: `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10, linha do SP1)

**Interfaces:**
- Consumes: `ProductPriceHistory` (Task 2); `changedByUserId` preenchido pelo middleware (Task 6).
- Produces: `interface PriceHistoryEntry { id: string; unitPrice: number; costPrice: number; validFrom: Date;
  source: PriceChangeSource; changedByUserId: string | null; changedByName: string | null }` exportada de
  `products.service.ts`; `ProductsService.findPriceHistory(id: string): Promise<PriceHistoryEntry[]>` —
  consumido pela web na sub-etapa 1.2.4.

- [ ] **Step 1: Escrever os testes (vão falhar)**

Create `backend/src/modules/products/product-price-history.int-spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { UserRole } from '../users/user.entity';
import { ProductsService } from './products.service';

describe('ProductsService.findPriceHistory', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('lista o histórico do mais recente para o mais antigo, com o nome de quem alterou', async () => {
    const companyId = await seedCompany('Empresa Histórico');
    const managerId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Gerente Histórico', 'gerente-historico@teste.local', 'x', 'manager', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const productId = await seedProduct({ companyId, barcode: '9001', unitPrice: 10, costPrice: 6 });
    const ctx = { companyId, userId: managerId, role: UserRole.MANAGER };
    await withTenant(ctx, () => new ProductsService().update(productId, { unitPrice: 12 }));

    const history = await withTenant(ctx, () => new ProductsService().findPriceHistory(productId));

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      unitPrice: 12,
      costPrice: 6,
      source: 'manual',
      changedByUserId: managerId,
      changedByName: 'Gerente Histórico',
    });
    expect(history[1]).toMatchObject({ unitPrice: 10, changedByName: null });
    expect(history[0].validFrom.getTime()).toBeGreaterThanOrEqual(history[1].validFrom.getTime());
  });

  it('devolve no máximo as 100 linhas mais recentes', async () => {
    const companyId = await seedCompany('Empresa Muitas Mudanças');
    const productId = await seedProduct({ companyId, barcode: '9002', unitPrice: 1 });
    await adminQuery(
      `INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", source)
       SELECT $1, $2, n, 0, now() + (n || ' seconds')::interval, 'bulk' FROM generate_series(1, 105) AS n`,
      [companyId, productId],
    );

    const history = await withTenant({ companyId }, () => new ProductsService().findPriceHistory(productId));

    expect(history).toHaveLength(100);
    expect(history[0].unitPrice).toBe(105);
  });

  it('produto de outra empresa responde 404 (a RLS não deixa enxergar)', async () => {
    const a = await seedCompany('Empresa A Histórico');
    const b = await seedCompany('Empresa B Histórico');
    const productOfB = await seedProduct({ companyId: b, barcode: '9003' });

    await expect(
      withTenant({ companyId: a }, () => new ProductsService().findPriceHistory(productOfB)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/products/product-price-history.int-spec.ts`
Expected: FAIL — erro de compilação `Property 'findPriceHistory' does not exist on type 'ProductsService'`.

- [ ] **Step 3: Implementar o serviço**

Modify `backend/src/modules/products/products.service.ts`:

Imports:
```ts
import { User } from '../users/user.entity';
import { PriceChangeSource, ProductPriceHistory } from './product-price-history.entity';
```

Antes de `@Injectable()`:
```ts
export interface PriceHistoryEntry {
  id: string;
  unitPrice: number;
  costPrice: number;
  validFrom: Date;
  source: PriceChangeSource;
  changedByUserId: string | null;
  changedByName: string | null;
}

const PRICE_HISTORY_LIMIT = 100;
```

Novo método na classe (depois de `update`):
```ts
  /**
   * Linha do tempo de preços do produto (sub-etapa 1.2.4 exibe no painel): as últimas 100 mudanças,
   * da mais recente para a mais antiga. Só colunas explícitas do usuário (nome) — nunca a entidade
   * inteira, que carrega dados de autenticação.
   */
  async findPriceHistory(id: string): Promise<PriceHistoryEntry[]> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    const rows = await manager
      .createQueryBuilder(ProductPriceHistory, 'history')
      .leftJoin(User, 'changedBy', 'changedBy.id = history.changedByUserId')
      .select('history.id', 'id')
      .addSelect('history.unitPrice', 'unitPrice')
      .addSelect('history.costPrice', 'costPrice')
      .addSelect('history.validFrom', 'validFrom')
      .addSelect('history.source', 'source')
      .addSelect('history.changedByUserId', 'changedByUserId')
      .addSelect('changedBy.name', 'changedByName')
      .where('history.productId = :id', { id })
      .orderBy('history.validFrom', 'DESC')
      .addOrderBy('history.seq', 'DESC')
      .limit(PRICE_HISTORY_LIMIT)
      .getRawMany<{
        id: string;
        unitPrice: string;
        costPrice: string;
        validFrom: Date;
        source: PriceChangeSource;
        changedByUserId: string | null;
        changedByName: string | null;
      }>();

    return rows.map((row) => ({
      ...row,
      unitPrice: Number(row.unitPrice),
      costPrice: Number(row.costPrice),
      changedByName: row.changedByName ?? null,
    }));
  }
```

- [ ] **Step 4: Expor a rota**

Modify `backend/src/modules/products/products.controller.ts` — depois do `findByBarcode`:
```ts
  // Linha do tempo de preços do produto (valor congelado das perdas — SP1, sub-etapa 1.2.3).
  @Get(':id/price-history')
  @Roles(UserRole.MANAGER)
  findPriceHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findPriceHistory(id);
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:int -- src/modules/products/product-price-history.int-spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 6: Checagem final de toda a sub-etapa**

Run, em sequência (nunca em paralelo):
```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
grep -rn "product.unitPrice\|product?.unitPrice\|product!.unitPrice\|product.costPrice" src/modules/losses --include=*.ts | grep -v "\.spec\.ts"
git status --short
```
Expected: unitário 19 suítes / 118; integração 12 arquivos / 49; `tsc exit=0`; o `grep` não imprime
nada; `git status` limpo além dos arquivos desta tarefa.

- [ ] **Step 7: Registrar o andamento nos documentos**

Modify `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` — no fim da seção 4.2
(antes de `### 4.3`), acrescentar:

```markdown
**Resultados (sub-etapa 1.2.3, executada em <data>):** `resolveLossValuation` + constantes SQL em
`losses-valuation.ts`; `LossesService.create/update` gravam o valor congelado (update só recalcula se
produto ou data mudarem de VALOR); relatórios, export, alertas e padrões suspeitos usam
`loss.unitPriceAtLoss`/`unitCostAtLoss`; `app.current_user_id` no middleware e `app.change_source =
'import'` na importação; `GET /products/:id/price-history`. Migration `1700000013000` endureceu os
triggers (usuário inexistente → NULL, fallback parcial por coluna, `search_path` fixo). Regressão F1
coberta por `losses-f1-regression.int-spec.ts`. **Deploy:** aplicar 10000–13000 no banco real em janela
de manutenção — os `ALTER TABLE` da 11000/12000 tomam `ACCESS EXCLUSIVE` em `products`/`losses` até o
commit, e o backfill da 12000 reescreve todas as perdas.
```

Modify `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` — na linha do SP1 da tabela da
seção 10: acrescentar ao status `Sub-etapa 1.2.3 (backend do valor congelado) concluída em <data>
(branch feat/cadastros-sp1-etapa-1-2-3).`, acrescentar à coluna Plano `1.2.3:
[plano](../plans/2026-09-23-sp1-etapa-1-2-3-backend-valor-congelado.md) (executado).`, atualizar os
baselines para os números do Step 6, e no bloco "Levar para o plano da 1.2.3" trocar o título por
"Pendências menores ainda abertas" mantendo só: índice só em `companyId` em `product_price_history`;
teste de backfill conferir FORCE também em `products`/`losses`.

- [ ] **Step 8: Commit**

```bash
cd /c/PROJETOS/SAAS
git add backend/src/modules/products/products.service.ts backend/src/modules/products/products.controller.ts backend/src/modules/products/product-price-history.int-spec.ts docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "feat(backend): GET /products/:id/price-history; andamento da sub-etapa 1.2.3" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (4.2 / 4.4):**
- Entidade `ProductPriceHistory` em `entities.ts`; `Loss` com as 3 colunas e a união de 5 valores → Task 2.
- `resolveLossValuation` (vigente, mais antiga, fallback, desempate por `seq`) + `LOSS_REVENUE_SQL`/`LOSS_COST_SQL` → Task 2.
- `create` usa `occurredAt`; `update` só recalcula ao mudar produto/data → Task 3.
- Base de cálculo em `losses.service.ts` (132, 133, 200, 201, 225, 243, 265, 303, 442) → Task 4;
  `losses-suspicious-patterns.ts` (56, 96, 140) e `losses-alerts.ts` (73, ~360) → Task 5. `top produtos`
  continua juntando `products` só para o nome → Task 4 (`topProductIdsInRange`, `reportByProduct`).
- Middleware define `app.current_user_id` (o `withTenant` do harness já definia desde a 1.1); importação
  define `app.change_source='import'` → Task 6.
- `GET /products/:id/price-history` (gerente, 100 linhas, mais recente primeiro) → Task 7.
- Testes 4.4: unitários de `create/update` (Task 3), specs de alertas/padrões com `unitPriceAtLoss`
  (Task 5), regressão F1 ponta a ponta (Task 4). `resolveLossValuation` em integração em vez de mock
  (decisão documentada na Task 2).
- Achados da revisão da 1.2.2 (seção 10 do mestre): fallback parcial, `search_path` → Task 1; origem
  `import` → Task 6; regressão F1 → Task 4; nota de deploy/locks → Task 7, Step 7. Ficam abertos (fora
  do escopo do spec): índice só em `companyId`, asserção extra de FORCE no teste de backfill.

**Decisões novas deste plano (não estavam no spec):** migration `1700000013000` (necessária porque o
middleware passar a definir o usuário tornaria a FK `changedByUserId` um ponto de falha); origem do
recálculo no `update` = a devolvida por `resolveLossValuation`, com `'recalculated'` reservado ao SP2;
alerta de preço zero com texto ajustado para "perdas registradas a preço zero".

**Varredura de placeholders:** `<data>` na Task 7, Step 7 é a data real de execução, preenchida pelo
executor — não é lacuna de especificação.

**Consistência de nomes:** `resolveLossValuation`, `LossValuation`, `LOSS_REVENUE_SQL`, `LOSS_COST_SQL`,
`lossValue`, `LossValuationSource`, `PriceChangeSource`, `ProductPriceHistory`, `PriceHistoryEntry`,
`findPriceHistory` — definidos uma vez (Tasks 2 e 7) e usados com a mesma assinatura nas demais.

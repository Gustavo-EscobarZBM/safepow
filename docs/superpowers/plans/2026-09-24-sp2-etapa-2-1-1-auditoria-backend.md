# SP2 · Sub-etapa 2.1.1 — Trilha de auditoria (backend) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda mudança em produtos, motivos, locais, perdas, usuários, empresa e faturamento passa a ser
gravada automaticamente numa trilha de auditoria que ninguém altera nem apaga; logins e importações viram
eventos; o gerente consulta e exporta pela API.

**Architecture:** Uma função SQL `audit_insert(...)` é o único ponto que grava em `audit_log` (lê quem/de
onde das variáveis de sessão, e grava com a empresa da própria linha — inclusive quando a escrita acontece
fora de contexto de tenant, como no login e no Painel Master). Um trigger genérico `audit_row_change()` em 7
tabelas calcula o diff e chama `audit_insert`; eventos que não são mudança de linha (login, resumo de
importação) chamam a mesma função via `recordAuditEvent`. O middleware passa a definir origem (web/mobile),
id da requisição e IP. API `GET /audit` (+ CSV) só para gerente.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL 16 (plpgsql), Jest 29 (`npm test`, `npm run test:int`).

**Spec:** [`docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md`](../specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md),
seção 2 (etapa 2.1). As telas (página Auditoria e gaveta Histórico) são a sub-etapa **2.1.2** (web).

## Global Constraints

- **Tabelas auditadas (spec 2.3):** `products`, `loss_reasons`, `loss_locations`, `losses`, `users`,
  `companies`, `company_monthly_revenue`. Sempre ignoradas no diff: `updatedAt`, `createdAt`, `id`,
  `companyId`. Por tabela: `products`: `sourceColumnMapping`; `companies`: `billingProviderCustomerId`,
  `currentPeriodEnd` (`status`/`planTier` **são** auditados). `passwordHash` ⇒ `{field:'password', from:null,
  to:'alterada'}`, nunca o valor.
- **Ação:** `INSERT` ⇒ `create`; `DELETE` ⇒ `delete`; `UPDATE` com `isActive` true→false ⇒ `archive`,
  false→true ⇒ `restore`; senão `update`; `UPDATE` sem campo relevante mudado não grava.
- **Append-only:** role de runtime com `SELECT, INSERT` e **`REVOKE UPDATE, DELETE`**; RLS `ENABLE`+`FORCE`
  com `TENANT_COMPANY_ID_PREDICATE`.
- **Decisões deste plano (não estavam no spec, com o motivo):**
  1. **Variável de origem própria `app.audit_source`** (não `app.change_source` como no spec): o trigger do
     histórico de preço usa `app.change_source` e só aceita `manual|import|bulk|retro_fix|erp|approval|backfill`
     — gravar `web`/`mobile` ali quebraria toda edição de produto. Valores: `web`, `mobile`, `import`,
     `system` (padrão).
  2. **`audit_insert` grava com a empresa da própria linha**, definindo `app.current_company_id` só durante o
     `INSERT` e restaurando o valor anterior em seguida: `companies` não tem RLS e é escrita sem contexto de
     tenant (login sincroniza status, Painel Master, webhook de cobrança); sem isso a política do `audit_log`
     barraria a gravação e **derrubaria o login**.
  3. **Empresa inexistente ⇒ não audita:** excluir uma empresa apaga os filhos em cascata; cada filho
     apagado dispararia uma auditoria apontando para a empresa que acabou de sumir (violação de FK ⇒ a
     exclusão da empresa quebraria). `DELETE` em `companies` também não é auditado (o log dela vai junto).
  4. **Coluna `entityLabel`** (nome legível no momento — `name` da linha, ou `ano/mês` no faturamento):
     sem ela a página Auditoria só mostraria UUIDs de registros que podem já não existir.
  5. **Falha ao auditar login não derruba o login** (registra no log do servidor e segue): a auditoria de
     login é valiosa, mas bloquear o acesso por ela é pior.
- `SET search_path = public, pg_temp` em toda função nova; nenhuma tabela nova sem RLS.
- **Migrations:** `1700000015000-AuditLog` e `1700000016000-AuditTriggers`. Banco de desenvolvimento só com
  autorização do usuário ao fim.
- **NUNCA rodar `npm run test:int` concorrentemente.**
- Comandos em `C:\PROJETOS\SAAS\backend`. **Baseline (confirme antes da Task 1):** `npm test` 21 suítes /
  151; `npm run test:int` 17 arquivos / 94; `tsc` limpo; `docker ps` com `backend-postgres-1` healthy.
- **Commits:** branch `feat/cadastros-sp2-etapa-2-1-1` a partir de `main`; um por tarefa; mensagem terminando
  com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Merge/push só com confirmação.

## Review Focus

1. **Escrita em tabela auditada fora de contexto de tenant** (login que atualiza o status da empresa,
   Painel Master criando empresa/gerente, webhook): funciona e é auditada, sem erro de RLS. → Task 2, testes
   "status da empresa sem tenant" e "criar empresa como no Painel Master".
2. **Excluir uma empresa com produtos, perdas e usuários** continua funcionando (cascata) mesmo com os
   triggers. → Task 2, teste "exclusão de empresa em cascata".
3. **Edição de produto pelo painel** continua funcionando e grava histórico de preço **e** auditoria com
   origem `web` (o conflito de `change_source` não pode voltar). → Task 3, teste HTTP "editar produto".
4. **Senha** nunca aparece no log, nem em criação nem em troca. → Task 2, testes de `users`.
5. **Filtros inválidos na API de auditoria** (`pageSize=500`, data inválida, `entityType` desconhecido) ⇒ 400,
   não 500. → Task 5, testes HTTP.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/database/migrations/1700000015000-AuditLog.ts` | criar | tabela, RLS, grants, `audit_insert` |
| `backend/src/database/migrations/1700000016000-AuditTriggers.ts` | criar | `audit_row_change` + triggers nas 7 tabelas |
| `backend/src/database/audit-log.int-spec.ts` | criar | tabela/função: RLS, append-only, contexto |
| `backend/src/database/audit-triggers.int-spec.ts` | criar | triggers por tabela |
| `backend/src/modules/audit/audit-log.entity.ts` | criar | entidade (só leitura) |
| `backend/src/modules/audit/audit-events.ts` | criar | `recordAuditEvent`, `auditSourceFromUserAgent`, tipos |
| `backend/src/modules/audit/audit-events.spec.ts` | criar | unitário de `auditSourceFromUserAgent` |
| `backend/src/modules/audit/dto/query-audit.dto.ts` | criar | filtros da API |
| `backend/src/modules/audit/audit.service.ts` | criar | consulta paginada e CSV |
| `backend/src/modules/audit/audit.controller.ts` | criar | `GET /audit`, `GET /audit/export` |
| `backend/src/modules/audit/audit.module.ts` | criar | módulo |
| `backend/src/modules/audit/audit.http.int-spec.ts` | criar | contratos HTTP |
| `backend/src/database/entities.ts` (+ `entities.spec.ts`) | modificar | registrar `AuditLog` (10 entidades) |
| `backend/src/app.module.ts` | modificar | importar `AuditModule` |
| `backend/src/common/tenant/tenant-context.middleware.ts` (+ int-spec) | modificar | origem, requestId, IP |
| `backend/src/modules/auth/auth.service.ts`, `auth.controller.ts` (+ int-spec novo) | modificar | eventos de login |
| `backend/src/modules/imports/imports.processor.ts` (+ int-spec) | modificar | modo resumo + evento `import` |

---

### Task 1: Tabela `audit_log` e função `audit_insert`

**Files:**
- Create: `backend/src/database/migrations/1700000015000-AuditLog.ts`
- Create: `backend/src/database/audit-log.int-spec.ts`

**Interfaces:**
- Produces: tabela `audit_log` (colunas da migration abaixo) e a função SQL
  `audit_insert(p_company uuid, p_entity_type text, p_entity_id uuid, p_entity_label text, p_action text,
  p_changes jsonb, p_summary jsonb) RETURNS void` — lê `app.current_user_id`, `app.audit_source`,
  `app.request_id`, `app.client_ip`, `app.audit_reason`. Usada pelas Tasks 2 e 4.

- [ ] **Step 1: Branch e baseline**

```bash
cd /c/PROJETOS/SAAS && git checkout main && git checkout -b feat/cadastros-sp2-etapa-2-1-1
cd backend && npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```
Expected: 21/151; 17/94; `tsc exit=0`.

- [ ] **Step 2: Testes (vão falhar)**

Create `backend/src/database/audit-log.int-spec.ts`:

```ts
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:int -- src/database/audit-log.int-spec.ts`
Expected: FAIL — `function audit_insert(...) does not exist` / `relation "audit_log" does not exist`.

- [ ] **Step 4: Migration**

Create `backend/src/database/migrations/1700000015000-AuditLog.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE } from '../helpers/rls';

/**
 * Trilha de auditoria (SP2, etapa 2.1). `audit_insert` é o ÚNICO ponto de gravação: lê quem/de onde das
 * variáveis de sessão e grava com a empresa da própria linha auditada — definindo app.current_company_id só
 * durante o INSERT e restaurando o valor anterior —, porque tabelas como "companies" (sem RLS) são escritas
 * fora de contexto de tenant (login, Painel Master, webhook) e a política do audit_log barraria a gravação.
 * Empresa inexistente (sendo excluída em cascata) ⇒ não grava: a linha violaria a FK e derrubaria a exclusão.
 */
export class AuditLog1700000015000 implements MigrationInterface {
  name = 'AuditLog1700000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "seq"         bigint GENERATED ALWAYS AS IDENTITY,
        "companyId"   uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "actorUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "actorName"   varchar(150) NULL,
        "actorRole"   varchar(20) NULL,
        "entityType"  varchar(40) NOT NULL,
        "entityId"    uuid NULL,
        "entityLabel" varchar(200) NULL,
        "action"      varchar(20) NOT NULL CHECK ("action" IN (
                        'create','update','archive','restore','delete','import','login','login_failed',
                        'approve','reject','retro_fix','request','justify')),
        "changes"     jsonb NOT NULL DEFAULT '[]'::jsonb,
        "summary"     jsonb NULL,
        "source"      varchar(20) NOT NULL DEFAULT 'system' CHECK ("source" IN ('web','mobile','import','system')),
        "reason"      text NULL,
        "requestId"   uuid NULL,
        "ip"          inet NULL,
        "createdAt"   timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_company_created" ON "audit_log" ("companyId", "createdAt" DESC, "seq" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_company_entity" ON "audit_log" ("companyId", "entityType", "entityId", "createdAt" DESC)`,
    );

    await queryRunner.query(`ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_audit_log" ON "audit_log"
      USING (${TENANT_COMPANY_ID_PREDICATE})
      WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
    `);
    // Os privilégios padrão do banco dão CRUD ao role da aplicação: é preciso REVOGAR explicitamente.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM inventory_saas_app';
          EXECUTE 'GRANT SELECT, INSERT ON "audit_log" TO inventory_saas_app';
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE FUNCTION audit_insert(
        p_company uuid, p_entity_type text, p_entity_id uuid, p_entity_label text,
        p_action text, p_changes jsonb, p_summary jsonb
      ) RETURNS void AS $$
      DECLARE
        v_actor_id   uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
        v_actor_name text;
        v_actor_role text;
        v_previous   text := current_setting('app.current_company_id', true);
      BEGIN
        IF p_company IS NULL OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company) THEN
          RETURN;
        END IF;
        -- Ator lido ANTES de trocar de empresa: na sessão original ele é visível pela RLS de users
        -- (inclusive o master_admin, visível só em sessão sem tenant). Invisível/inexistente ⇒ NULL.
        IF v_actor_id IS NOT NULL THEN
          SELECT u.name, u.role::text INTO v_actor_name, v_actor_role FROM users u WHERE u.id = v_actor_id;
          IF NOT FOUND THEN
            v_actor_id := NULL;
          END IF;
        END IF;

        PERFORM set_config('app.current_company_id', p_company::text, true);
        INSERT INTO audit_log ("companyId", "actorUserId", "actorName", "actorRole", "entityType", "entityId",
                               "entityLabel", "action", "changes", "summary", "source", "reason", "requestId", "ip")
        VALUES (
          p_company, v_actor_id, v_actor_name, v_actor_role, p_entity_type, p_entity_id, left(p_entity_label, 200),
          p_action, COALESCE(p_changes, '[]'::jsonb), p_summary,
          COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'system'),
          NULLIF(current_setting('app.audit_reason', true), ''),
          NULLIF(current_setting('app.request_id', true), '')::uuid,
          NULLIF(current_setting('app.client_ip', true), '')::inet
        );
        PERFORM set_config('app.current_company_id', COALESCE(v_previous, ''), true);
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_insert(uuid, text, uuid, text, text, jsonb, jsonb)`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log"`);
  }
}
```

- [ ] **Step 5: Rodar, checar e commit**

```bash
npm run test:int -- src/database/audit-log.int-spec.ts
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/database/migrations/1700000015000-AuditLog.ts src/database/audit-log.int-spec.ts
git commit -m "feat(backend): tabela audit_log (append-only, RLS) e função audit_insert" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 6; integração 18/100; `tsc exit=0`.

---

### Task 2: Trigger genérico nas 7 tabelas

**Files:**
- Create: `backend/src/database/migrations/1700000016000-AuditTriggers.ts`
- Create: `backend/src/database/audit-triggers.int-spec.ts`

**Interfaces:**
- Consumes: `audit_insert` (Task 1).
- Produces: função `audit_row_change()` e triggers `trg_audit_<tabela>`; `app.audit_mode = 'summary'`
  desliga o trigger na transação (usado pela Task 4).

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/database/audit-triggers.int-spec.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/database/audit-triggers.int-spec.ts`
Expected: FAIL — sem triggers, nenhuma linha em `audit_log` (listas vazias / `undefined`).

- [ ] **Step 3: Migration**

Create `backend/src/database/migrations/1700000016000-AuditTriggers.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tabela ⇒ [tipo de entidade, colunas ignoradas no diff (além de id/companyId/createdAt/updatedAt)]. */
const AUDITED_TABLES: Record<string, [string, string]> = {
  products: ['product', 'sourceColumnMapping'],
  loss_reasons: ['loss_reason', ''],
  loss_locations: ['loss_location', ''],
  losses: ['loss', ''],
  users: ['user', ''],
  companies: ['company', 'billingProviderCustomerId,currentPeriodEnd'],
  company_monthly_revenue: ['company_revenue', ''],
};

/**
 * Trigger genérico de auditoria (SP2, etapa 2.1 — decisão U4: trigger, não disciplina de serviço). Nenhum
 * escritor escapa (painel, app, importação, ERP futuro, SQL avulso). Grava via audit_insert (1700000015000).
 */
export class AuditTriggers1700000016000 implements MigrationInterface {
  name = 'AuditTriggers1700000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION audit_row_change() RETURNS trigger AS $$
      DECLARE
        v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
        v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
        v_row     jsonb := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
        v_ignored text[] := ARRAY['id', 'companyId', 'createdAt', 'updatedAt']
                            || COALESCE(string_to_array(NULLIF(TG_ARGV[1], ''), ','), ARRAY[]::text[]);
        v_changes jsonb := '[]'::jsonb;
        v_action  text;
        v_company uuid;
        v_label   text;
        v_key     text;
      BEGIN
        IF current_setting('app.audit_mode', true) = 'summary' THEN
          RETURN NULL;
        END IF;
        IF TG_TABLE_NAME = 'companies' THEN
          IF TG_OP = 'DELETE' THEN
            RETURN NULL; -- o log da empresa vai junto em cascata
          END IF;
          v_company := (v_row ->> 'id')::uuid;
        ELSE
          v_company := (v_row ->> 'companyId')::uuid;
        END IF;
        IF v_company IS NULL THEN
          RETURN NULL; -- master_admin (sem empresa)
        END IF;

        FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
          CONTINUE WHEN v_key = ANY (v_ignored);
          IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
            IF v_key = 'passwordHash' THEN
              v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'password', 'from', NULL, 'to', 'alterada'));
            ELSE
              v_changes := v_changes || jsonb_build_array(
                jsonb_build_object('field', v_key, 'from', v_old -> v_key, 'to', v_new -> v_key));
            END IF;
          END IF;
        END LOOP;

        IF TG_OP = 'INSERT' THEN
          v_action := 'create';
        ELSIF TG_OP = 'DELETE' THEN
          v_action := 'delete';
        ELSE
          IF jsonb_array_length(v_changes) = 0 THEN
            RETURN NULL;
          END IF;
          IF (v_old ->> 'isActive') = 'true' AND (v_new ->> 'isActive') = 'false' THEN
            v_action := 'archive';
          ELSIF (v_old ->> 'isActive') = 'false' AND (v_new ->> 'isActive') = 'true' THEN
            v_action := 'restore';
          ELSE
            v_action := 'update';
          END IF;
        END IF;

        v_label := CASE
          WHEN v_row ? 'name' THEN v_row ->> 'name'
          WHEN v_row ? 'year' THEN (v_row ->> 'year') || '/' || lpad(v_row ->> 'month', 2, '0')
        END;

        PERFORM audit_insert(v_company, TG_ARGV[0], (v_row ->> 'id')::uuid, v_label, v_action, v_changes, NULL);
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);

    for (const [table, [entityType, ignored]] of Object.entries(AUDITED_TABLES)) {
      await queryRunner.query(`
        CREATE TRIGGER "trg_audit_${table}"
          AFTER INSERT OR UPDATE OR DELETE ON "${table}"
          FOR EACH ROW EXECUTE FUNCTION audit_row_change('${entityType}', '${ignored}')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of Object.keys(AUDITED_TABLES)) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_audit_${table}" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_row_change()`);
  }
}
```

- [ ] **Step 4: Rodar, checar a suíte inteira e commit**

```bash
npm run test:int -- src/database/audit-triggers.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/database/migrations/1700000016000-AuditTriggers.ts src/database/audit-triggers.int-spec.ts
git commit -m "feat(backend): trigger de auditoria em produtos, motivos, locais, perdas, usuários, empresa e faturamento" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 11; unitário inalterado; integração 19/111 **e todos os testes antigos verdes** (os
triggers passam a disparar em todo teste que grava nessas tabelas — se algum antigo quebrar, é bug do trigger:
investigar com `superpowers:systematic-debugging`, não mexer no teste antigo); `tsc exit=0`.

---

### Task 3: Middleware — origem, id da requisição e IP

**Files:**
- Create: `backend/src/modules/audit/audit-events.ts`
- Create: `backend/src/modules/audit/audit-events.spec.ts`
- Modify: `backend/src/common/tenant/tenant-context.middleware.ts`
- Modify: `backend/src/common/tenant/tenant-context.middleware.int-spec.ts`

**Interfaces:**
- Produces (`audit-events.ts`): `type AuditSource = 'web' | 'mobile' | 'import' | 'system'`;
  `auditSourceFromUserAgent(userAgent: string | undefined): 'web' | 'mobile'`; `Request.requestId?: string`
  (augmentação do Express, no middleware). Task 4 acrescenta `recordAuditEvent` ao mesmo arquivo.

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/modules/audit/audit-events.spec.ts`:
```ts
import { auditSourceFromUserAgent } from './audit-events';

describe('auditSourceFromUserAgent', () => {
  it('cliente HTTP do app Flutter (Dart/...) ⇒ mobile', () => {
    expect(auditSourceFromUserAgent('Dart/3.5 (dart:io)')).toBe('mobile');
  });

  it('navegador ou ausente ⇒ web', () => {
    expect(auditSourceFromUserAgent('Mozilla/5.0 (Windows NT 10.0)')).toBe('web');
    expect(auditSourceFromUserAgent(undefined)).toBe('web');
  });
});
```

Modify `backend/src/common/tenant/tenant-context.middleware.int-spec.ts`:
- em `startServer`, depois da rota `/user-setting`:
```ts
  app.post('/audit-context', (_req, res) => {
    void getTenantManager()
      .query(
        `SELECT current_setting('app.audit_source', true) AS source,
                current_setting('app.request_id', true) AS "requestId",
                current_setting('app.client_ip', true) AS ip`,
      )
      .then((rows: Record<string, string>[]) => res.status(200).json(rows[0]));
  });
  app.post('/touch-product', (_req, res) => {
    void getTenantManager()
      .query(`UPDATE products SET name = name || ' (editado)', "unitPrice" = "unitPrice" + 1 RETURNING id`)
      .then((rows: { id: string }[]) => res.status(200).json({ id: rows[0].id }));
  });
```
- ajustar o helper `post` para aceitar cabeçalhos extras e devolver os cabeçalhos da resposta:
```ts
function post(
  baseUrl: string,
  path: string,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${baseUrl}${path}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...extraHeaders } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}
```
- ao fim do arquivo, um `describe` novo:
```ts
describe('TenantContextMiddleware — contexto de auditoria (SP2)', () => {
  let server: TestServer;
  let token: string;
  let companyId: string;
  let managerId: string;

  beforeAll(async () => {
    server = await startServer(await appDataSource());
  });
  afterAll(async () => {
    await server.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Contexto');
    managerId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Gerente Contexto', 'ctx@teste.local', 'x', 'manager', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    token = await new JwtService({ secret: JWT_SECRET }).signAsync({ sub: managerId, role: UserRole.MANAGER, companyId });
  });

  it('navegador ⇒ source web; requestId igual ao cabeçalho X-Request-Id; IP preenchido', async () => {
    const { body, headers } = await post(server.baseUrl, '/audit-context', token, { 'User-Agent': 'Mozilla/5.0' });
    const context = JSON.parse(body);

    expect(context.source).toBe('web');
    expect(context.requestId).toBe(headers['x-request-id']);
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.ip).not.toBe('');
  });

  it('app Flutter (User-Agent Dart/...) ⇒ source mobile', async () => {
    const { body } = await post(server.baseUrl, '/audit-context', token, { 'User-Agent': 'Dart/3.5 (dart:io)' });
    expect(JSON.parse(body).source).toBe('mobile');
  });

  it('editar produto pelo painel grava histórico de preço (manual) E auditoria (web) com ator e requestId', async () => {
    const productId = (
      await adminQuery(
        `INSERT INTO products ("companyId", barcode, name, "unitPrice") VALUES ($1, '1', 'Arroz', 10) RETURNING id`,
        [companyId],
      )
    )[0].id;

    const { status, headers } = await post(server.baseUrl, '/touch-product', token, { 'User-Agent': 'Mozilla/5.0' });

    expect(status).toBe(200);
    const history = await adminQuery(
      `SELECT source FROM product_price_history WHERE "productId" = $1 ORDER BY seq DESC LIMIT 1`,
      [productId],
    );
    expect(history[0].source).toBe('manual');
    const [audit] = await adminQuery(
      `SELECT source, "actorUserId", "requestId" FROM audit_log WHERE "entityId" = $1 AND action = 'update'`,
      [productId],
    );
    expect(audit).toEqual({ source: 'web', actorUserId: managerId, requestId: headers['x-request-id'] });
  });
});
```
(acrescentar `adminQuery` ao import de `../../test-utils/test-db`, se ainda não estiver.)

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx jest src/modules/audit/audit-events.spec.ts
npm run test:int -- src/common/tenant/tenant-context.middleware.int-spec.ts
```
Expected: unitário FAIL (`Cannot find module './audit-events'`); integração: os 3 testes novos falham
(`source` vazio/`null`, sem `x-request-id`).

- [ ] **Step 3: Implementar**

Create `backend/src/modules/audit/audit-events.ts`:
```ts
/** Origem de um registro de auditoria (coluna audit_log.source). */
export type AuditSource = 'web' | 'mobile' | 'import' | 'system';

/**
 * O app Flutter usa o cliente HTTP do Dart, que se identifica como "Dart/<versão> (dart:io)". Não exige
 * versão nova do app para saber que a mudança veio do celular.
 */
export function auditSourceFromUserAgent(userAgent: string | undefined): 'web' | 'mobile' {
  return userAgent?.startsWith('Dart/') ? 'mobile' : 'web';
}
```

Modify `backend/src/common/tenant/tenant-context.middleware.ts`:
- imports: `import { randomUUID } from 'crypto';`, `import { isIP } from 'net';`,
  `import { auditSourceFromUserAgent } from '../../modules/audit/audit-events';`
- na augmentação do Express, acrescentar `requestId?: string;` à interface `Request`.
- no início de `use`, antes de criar o `queryRunner`:
```ts
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
```
- dentro do `try`, depois do bloco do `app.current_user_id`:
```ts
      // Contexto da auditoria (SP2): origem (app × painel), id da requisição e IP — lidos pelo audit_insert.
      // Variável própria (app.audit_source), NÃO app.change_source: o histórico de preço usa esta última e
      // só aceita manual/import/…; gravar web/mobile nela quebraria toda edição de produto.
      const clientIp = req.ip && isIP(req.ip.replace(/^::ffff:/, '')) ? req.ip.replace(/^::ffff:/, '') : '';
      await queryRunner.query(
        `SELECT set_config('app.audit_source', $1, true), set_config('app.request_id', $2, true),
                set_config('app.client_ip', $3, true)`,
        [auditSourceFromUserAgent(req.headers['user-agent']), requestId, clientIp],
      );
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npx jest src/modules/audit/audit-events.spec.ts
npm run test:int -- src/common/tenant/tenant-context.middleware.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/audit/audit-events.ts src/modules/audit/audit-events.spec.ts src/common/tenant/tenant-context.middleware.ts src/common/tenant/tenant-context.middleware.int-spec.ts
git commit -m "feat(backend): middleware define origem, id da requisição e IP para a auditoria" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; unitário 22/153; integração 19/114; `tsc exit=0`.

---

### Task 4: Eventos explícitos — login e resumo de importação

**Files:**
- Modify: `backend/src/modules/audit/audit-events.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.controller.ts`
- Create: `backend/src/modules/auth/auth-audit.int-spec.ts`
- Modify: `backend/src/modules/imports/imports.processor.ts`, `imports.processor.int-spec.ts`

**Interfaces:**
- Consumes: `audit_insert` (Task 1), `auditSourceFromUserAgent`/`AuditSource` (Task 3), modo resumo (Task 2).
- Produces: `recordAuditEvent(manager: { query(sql: string, params?: unknown[]): Promise<unknown> }, event:
  AuditEvent): Promise<void>` com `interface AuditEvent { companyId: string; entityType: string; entityId:
  string | null; entityLabel?: string | null; action: string; changes?: unknown[]; summary?: Record<string,
  unknown> | null }`; `AuthService.login(email, password, client?: LoginClientInfo)` com `interface
  LoginClientInfo { ip?: string; userAgent?: string; requestId?: string }`.

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/modules/auth/auth-audit.int-spec.ts`:
```ts
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Company } from '../companies/company.entity';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { AuthService } from './auth.service';

async function service(): Promise<AuthService> {
  const ds = await appDataSource();
  return new AuthService(ds, new JwtService({ secret: 'teste' }), ds.getRepository(Company));
}

describe('AuthService — auditoria de login (SP2)', () => {
  let companyId: string;
  let userId: string;
  const email = 'login-audit@teste.local';

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Login');
    userId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Ana', $1, $2, 'manager', $3) RETURNING id`,
        [email, await bcrypt.hash('senha-certa', 4), companyId],
      )
    )[0].id;
  });
  afterAll(() => closeTestConnections());

  it('login com sucesso grava "login" com ator, origem, IP e requestId', async () => {
    const requestId = randomUUID();

    await (await service()).login(email, 'senha-certa', { ip: '10.1.2.3', userAgent: 'Dart/3.5 (dart:io)', requestId });

    const rows = await adminQuery(
      `SELECT action, "entityType", "entityId", "actorUserId", source, ip, "requestId" FROM audit_log WHERE action LIKE 'login%'`,
    );
    expect(rows).toEqual([
      { action: 'login', entityType: 'session', entityId: userId, actorUserId: userId, source: 'mobile', ip: '10.1.2.3', requestId },
    ]);
  });

  it('senha errada grava "login_failed" (e o login continua recusando)', async () => {
    await expect((await service()).login(email, 'senha-errada', { userAgent: 'Mozilla/5.0' })).rejects.toThrow();

    const rows = await adminQuery(`SELECT action, source FROM audit_log WHERE action LIKE 'login%'`);
    expect(rows).toEqual([{ action: 'login_failed', source: 'web' }]);
  });

  it('e-mail inexistente: não grava nada (não há empresa a quem pertença)', async () => {
    await expect((await service()).login('ninguem@teste.local', 'x')).rejects.toThrow();
    expect(await adminQuery(`SELECT id FROM audit_log WHERE action LIKE 'login%'`)).toHaveLength(0);
  });
});
```

Modify `backend/src/modules/imports/imports.processor.int-spec.ts` — no `describe` existente, ao fim:
```ts
  it('importação grava UM evento "import" com o resumo, e nenhum evento por produto', async () => {
    const companyId = await seedCompany('Empresa Resumo');
    const existingId = await seedProduct({ companyId, barcode: '8201', unitPrice: 10 });
    const archivedId = await seedProduct({ companyId, barcode: '8202', unitPrice: 10 });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archivedId]);
    const auditBefore = (await adminQuery(`SELECT count(*)::int AS n FROM audit_log`))[0].n;
    const importJobId = (
      await adminQuery(
        `INSERT INTO import_jobs ("companyId", "fileName", "storageKey") VALUES ($1, 'p.xlsx', 'k') RETURNING id`,
        [companyId],
      )
    )[0].id;
    const buffer = await spreadsheet([
      ['8201', 'Existente', 11],
      ['8202', 'Reativado', 10],
      ['8203', 'Novo', 5],
    ]);
    const storage = { downloadBuffer: async () => buffer } as unknown as StorageService;

    await new ImportsProcessor(await appDataSource(), storage).process({
      data: {
        importJobId,
        companyId,
        storageKey: 'k',
        mapping: { barcodeColumn: 'Codigo', nameColumn: 'Nome', unitPriceColumn: 'Preco' },
      },
    } as Job<ProductImportJobData>);

    const events = await adminQuery(
      `SELECT action, "entityType", "entityId", source, summary FROM audit_log ORDER BY seq OFFSET $1`,
      [auditBefore],
    );
    expect(events).toEqual([
      {
        action: 'import',
        entityType: 'import_job',
        entityId: importJobId,
        source: 'import',
        summary: { status: 'completed', totalRows: 3, created: 1, updated: 1, reactivated: 1, errors: 0 },
      },
    ]);
    expect(existingId).toBeDefined();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:int -- src/modules/auth/auth-audit.int-spec.ts src/modules/imports/imports.processor.int-spec.ts
```
Expected: login: FAIL (nenhuma linha `login`/`login_failed`; o 3º teste pode passar — é guarda);
importação: FAIL (há eventos por produto e nenhum `import`).

- [ ] **Step 3: Implementar**

Modify `backend/src/modules/audit/audit-events.ts` — acrescentar ao fim:
```ts
export interface AuditEvent {
  companyId: string;
  entityType: string;
  entityId: string | null;
  entityLabel?: string | null;
  action: string;
  changes?: unknown[];
  summary?: Record<string, unknown> | null;
}

/**
 * Registra um evento que não é mudança de linha (login, resumo de importação, decisões de aprovação).
 * Mesma função SQL do trigger (audit_insert): ator, origem, requestId, IP e justificativa vêm das variáveis
 * de sessão da transação de `manager`.
 */
export async function recordAuditEvent(
  manager: { query(sql: string, params?: unknown[]): Promise<unknown> },
  event: AuditEvent,
): Promise<void> {
  await manager.query(`SELECT audit_insert($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`, [
    event.companyId,
    event.entityType,
    event.entityId,
    event.entityLabel ?? null,
    event.action,
    JSON.stringify(event.changes ?? []),
    event.summary ? JSON.stringify(event.summary) : null,
  ]);
}
```

Modify `backend/src/modules/auth/auth.service.ts`:
- imports: `Logger` em `@nestjs/common`; `import { auditSourceFromUserAgent, recordAuditEvent } from '../audit/audit-events';`
- antes da classe:
```ts
export interface LoginClientInfo {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}
```
- na classe: `private readonly logger = new Logger(AuthService.name);`
- assinatura: `async login(email: string, password: string, client: LoginClientInfo = {}) {`
- trocar o bloco
```ts
    if (!user || !user.isActive) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
```
por
```ts
    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    const passwordMatches = user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!passwordMatches) {
      await this.auditLogin(user, 'login_failed', client);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
```
- logo antes de `const payload = …`: `await this.auditLogin(user, 'login', client);`
- novo método privado:
```ts
  /**
   * Login roda sem contexto de tenant (e a transação do middleware é desfeita em 401) — por isso grava numa
   * transação própria, com o contexto do usuário. Falha ao auditar NÃO derruba o login: registra no log do
   * servidor e segue.
   */
  private async auditLogin(user: AuthLookupRow, action: 'login' | 'login_failed', client: LoginClientInfo) {
    if (!user.companyId) return;
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `SELECT set_config('app.current_company_id', $1, true), set_config('app.current_user_id', $2, true),
                  set_config('app.audit_source', $3, true), set_config('app.request_id', $4, true),
                  set_config('app.client_ip', $5, true)`,
          [user.companyId, user.id, auditSourceFromUserAgent(client.userAgent), client.requestId ?? '', client.ip ?? ''],
        );
        await recordAuditEvent(manager, {
          companyId: user.companyId!,
          entityType: 'session',
          entityId: user.id,
          entityLabel: user.name,
          action,
        });
      });
    } catch (error) {
      this.logger.warn(`Não foi possível auditar o ${action} de ${user.id}: ${(error as Error).message}`);
    }
  }
```

Modify `backend/src/modules/auth/auth.controller.ts`:
```ts
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
```
```ts
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip?.replace(/^::ffff:/, '');
    return this.authService.login(dto.email, dto.password, {
      ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
  }
```

Modify `backend/src/modules/imports/imports.processor.ts`:
- import: `import { recordAuditEvent } from '../audit/audit-events';`
- depois do `set_config('app.change_source', 'import', true)`:
```ts
      // Auditoria em modo resumo (SP2): em vez de uma linha por produto, um evento "import" no fim. As
      // mudanças de preço continuam uma a uma no product_price_history (source import).
      await manager.query(
        `SELECT set_config('app.audit_mode', 'summary', true), set_config('app.audit_source', 'import', true)`,
      );
```
- ao lado de `let successCount = 0;`: `let created = 0; let updated = 0; let reactivated = 0;`
- no ramo `if (existing) {`, antes de `existing.isActive = true;`:
```ts
              if (existing.isActive) updated++;
              else reactivated++;
```
- no ramo `else {` (produto novo), depois do `save`: `created++;`
- logo depois de `await manager.save(importJob);` no caminho de sucesso (status COMPLETED):
```ts
        await recordAuditEvent(manager, {
          companyId,
          entityType: 'import_job',
          entityId: importJobId,
          entityLabel: importJob.fileName,
          action: 'import',
          summary: { status: 'completed', totalRows, created, updated, reactivated, errors: totalRows - successCount },
        });
```
- e no caminho de erro fatal, depois do `await manager.save(importJob);`:
```ts
        await recordAuditEvent(manager, {
          companyId,
          entityType: 'import_job',
          entityId: importJobId,
          entityLabel: importJob.fileName,
          action: 'import',
          summary: { status: 'failed', totalRows, created, updated, reactivated, errors: totalRows - successCount },
        });
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npm run test:int -- src/modules/auth/auth-audit.int-spec.ts src/modules/imports/imports.processor.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/audit/audit-events.ts src/modules/auth/auth.service.ts src/modules/auth/auth.controller.ts src/modules/auth/auth-audit.int-spec.ts src/modules/imports/imports.processor.ts src/modules/imports/imports.processor.int-spec.ts
git commit -m "feat(backend): auditoria de login (sucesso/falha) e resumo de importação" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; unitário 22/153 (os testes existentes de `AuthService` continuam verdes: o `dataSource`
mockado não tem `transaction`, e a falha ao auditar é engolida por desenho); integração 20/118;
`tsc exit=0`.

---

### Task 5: API `GET /audit` e `GET /audit/export`

**Files:**
- Create: `backend/src/modules/audit/audit-log.entity.ts`, `dto/query-audit.dto.ts`, `audit.service.ts`,
  `audit.controller.ts`, `audit.module.ts`, `audit.http.int-spec.ts`
- Modify: `backend/src/database/entities.ts`, `backend/src/database/entities.spec.ts`, `backend/src/app.module.ts`

**Interfaces:**
- Consumes: tabela `audit_log` (Task 1).
- Produces (para a 2.1.2 — web): `GET /audit?entityType=&entityId=&actorUserId=&action=&from=&to=&page=
  &pageSize=` → `{ items: AuditLogEntry[]; total; page; pageSize }` (mais recente primeiro) e `GET
  /audit/export` (mesmos filtros, sem page/pageSize) → CSV. `AuditLogEntry` = `{ id, createdAt, actorUserId,
  actorName, actorRole, entityType, entityId, entityLabel, action, changes, summary, source, reason,
  requestId, ip }`.

- [ ] **Step 1: Testes HTTP (vão falhar)**

Create `backend/src/modules/audit/audit.http.int-spec.ts`:
```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantContextMiddleware } from '../../common/tenant/tenant-context.middleware';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { UserRole } from '../users/user.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

const JWT_SECRET = 'segredo-somente-de-teste';

async function startApp() {
  const moduleRef = await Test.createTestingModule({ controllers: [AuditController], providers: [AuditService] })
    .overrideGuard(SubscriptionGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const middleware = new TenantContextMiddleware(new JwtService({ secret: JWT_SECRET }), await appDataSource());
  app.use((req: Request, res: Response, next: NextFunction) => void middleware.use(req, res, next));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

async function get(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  return { status: response.status, body: isJson && text ? JSON.parse(text) : text, headers: response.headers };
}

describe('AuditController (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerToken: string;
  let employeeToken: string;
  let productId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa API Audit');
    const managerId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('G', 'g-audit@teste.local', 'x', 'manager', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const employeeId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('F', 'f-audit@teste.local', 'x', 'employee', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const jwt = new JwtService({ secret: JWT_SECRET });
    managerToken = await jwt.signAsync({ sub: managerId, role: UserRole.MANAGER, companyId });
    employeeToken = await jwt.signAsync({ sub: employeeId, role: UserRole.EMPLOYEE, companyId });
    productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz; "tipo 1"', unitPrice: 10 });
    await adminQuery(`UPDATE products SET "unitPrice" = 12 WHERE id = $1`, [productId]);
  });

  it('lista mais recente primeiro, com total e paginação', async () => {
    const { status, body } = await get(baseUrl, '/api/audit?pageSize=2', managerToken);

    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 2 });
    expect(body.total).toBeGreaterThanOrEqual(4); // 2 usuários + produto create + update
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ entityType: 'product', action: 'update', entityLabel: 'Arroz; "tipo 1"' });
  });

  it('filtra por entidade (gaveta Histórico)', async () => {
    const { body } = await get(baseUrl, `/api/audit?entityType=product&entityId=${productId}`, managerToken);
    expect(body.items.map((i: { action: string }) => i.action)).toEqual(['update', 'create']);
  });

  it('filtra por ação e período', async () => {
    const { body } = await get(baseUrl, '/api/audit?action=create&from=2000-01-01T00:00:00Z&to=2999-01-01T00:00:00Z', managerToken);
    expect(body.items.every((i: { action: string }) => i.action === 'create')).toBe(true);
  });

  it.each(['pageSize=500', 'page=0', 'entityType=nave', 'action=explodir', 'from=ontem', 'entityId=nao-uuid', 'foo=bar'])(
    'GET /audit?%s ⇒ 400',
    async (query) => {
      const { status } = await get(baseUrl, `/api/audit?${query}`, managerToken);
      expect(status).toBe(400);
    },
  );

  it('só gerente (403 para funcionário)', async () => {
    expect((await get(baseUrl, '/api/audit', employeeToken)).status).toBe(403);
    expect((await get(baseUrl, '/api/audit/export', employeeToken)).status).toBe(403);
  });

  it('export CSV: BOM, ";" como separador, aspas escapadas, alterações legíveis', async () => {
    const { status, body, headers } = await get(baseUrl, `/api/audit/export?entityId=${productId}`, managerToken);

    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('text/csv');
    expect(headers.get('content-disposition')).toContain('attachment');
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = (body as string).slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Data/hora;Pessoa;Papel;Origem;Ação;Entidade;Registro;Alterações;Justificativa;IP');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Arroz; ""tipo 1"""');
    expect(lines[1]).toContain('unitPrice: 10 → 12');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/audit/audit.http.int-spec.ts`
Expected: FAIL na compilação — `Cannot find module './audit.controller'`.

- [ ] **Step 3: Implementar**

Create `backend/src/modules/audit/audit-log.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Trilha de auditoria (migration 1700000015000). Append-only e gravada SÓ pela função audit_insert
 * (trigger/eventos) — a aplicação apenas lê; todas as colunas são insert/update: false.
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'bigint', insert: false, update: false }) seq: string;
  @Column({ type: 'uuid', insert: false, update: false }) companyId: string;
  @Column({ type: 'uuid', nullable: true, insert: false, update: false }) actorUserId: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true, insert: false, update: false }) actorName: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true, insert: false, update: false }) actorRole: string | null;
  @Column({ type: 'varchar', length: 40, insert: false, update: false }) entityType: string;
  @Column({ type: 'uuid', nullable: true, insert: false, update: false }) entityId: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true, insert: false, update: false }) entityLabel: string | null;
  @Column({ type: 'varchar', length: 20, insert: false, update: false }) action: string;
  @Column({ type: 'jsonb', insert: false, update: false }) changes: { field: string; from: unknown; to: unknown }[];
  @Column({ type: 'jsonb', nullable: true, insert: false, update: false }) summary: Record<string, unknown> | null;
  @Column({ type: 'varchar', length: 20, insert: false, update: false }) source: string;
  @Column({ type: 'text', nullable: true, insert: false, update: false }) reason: string | null;
  @Column({ type: 'uuid', nullable: true, insert: false, update: false }) requestId: string | null;
  @Column({ type: 'inet', nullable: true, insert: false, update: false }) ip: string | null;
  @CreateDateColumn({ type: 'timestamptz', insert: false, update: false }) createdAt: Date;
}
```

Create `backend/src/modules/audit/dto/query-audit.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const AUDIT_ENTITY_TYPES = [
  'product', 'loss_reason', 'loss_location', 'loss', 'user', 'company', 'company_revenue', 'import_job',
  'session', 'change_request',
] as const;
export const AUDIT_ACTIONS = [
  'create', 'update', 'archive', 'restore', 'delete', 'import', 'login', 'login_failed', 'approve', 'reject',
  'retro_fix', 'request', 'justify',
] as const;

/** Filtros da auditoria (GET /audit e /audit/export). */
export class QueryAuditDto {
  @IsOptional() @IsIn(AUDIT_ENTITY_TYPES) entityType?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsIn(AUDIT_ACTIONS) action?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
```

Create `backend/src/modules/audit/audit.service.ts`:
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { getTenantManager } from '../../common/tenant/tenant-storage';
import { AuditLog } from './audit-log.entity';
import { QueryAuditDto } from './dto/query-audit.dto';

export const AUDIT_DEFAULT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_LIMIT = 50_000;

const CSV_HEADER = ['Data/hora', 'Pessoa', 'Papel', 'Origem', 'Ação', 'Entidade', 'Registro', 'Alterações', 'Justificativa', 'IP'];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function describeChanges(changes: AuditLog['changes']): string {
  return changes.map((c) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' | ');
}

@Injectable()
export class AuditService {
  private filtered(query: QueryAuditDto): SelectQueryBuilder<AuditLog> {
    const qb = getTenantManager().createQueryBuilder(AuditLog, 'audit');
    if (query.entityType) qb.andWhere('audit.entityType = :entityType', { entityType: query.entityType });
    if (query.entityId) qb.andWhere('audit.entityId = :entityId', { entityId: query.entityId });
    if (query.actorUserId) qb.andWhere('audit.actorUserId = :actorUserId', { actorUserId: query.actorUserId });
    if (query.action) qb.andWhere('audit.action = :action', { action: query.action });
    if (query.from) qb.andWhere('audit.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('audit.createdAt <= :to', { to: new Date(query.to) });
    return qb.orderBy('audit.createdAt', 'DESC').addOrderBy('audit.seq', 'DESC');
  }

  async list(query: QueryAuditDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? AUDIT_DEFAULT_PAGE_SIZE;
    const [items, total] = await this.filtered(query)
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: items.map(({ seq: _seq, companyId: _companyId, ...rest }) => rest), total, page, pageSize };
  }

  /** CSV para Excel pt-BR: BOM UTF-8, ";" como separador, CRLF. Acima do limite, pede para filtrar. */
  async exportCsv(query: QueryAuditDto): Promise<string> {
    const qb = this.filtered(query);
    const total = await qb.getCount();
    if (total > AUDIT_EXPORT_LIMIT) {
      throw new BadRequestException(
        `A exportação tem ${total} linhas (máximo ${AUDIT_EXPORT_LIMIT}). Filtre por período ou entidade.`,
      );
    }
    const rows = await qb.getMany();
    const lines = [CSV_HEADER.join(';')];
    for (const row of rows) {
      lines.push(
        [
          row.createdAt.toISOString(),
          row.actorName,
          row.actorRole,
          row.source,
          row.action,
          row.entityType,
          row.entityLabel ?? row.entityId,
          describeChanges(row.changes),
          row.reason,
          row.ip,
        ]
          .map(csvCell)
          .join(';'),
      );
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
}
```

Create `backend/src/modules/audit/audit.controller.ts`:
```ts
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

/** Trilha de auditoria (SP2, 2.1) — só gerente até o papel "auditor" do SP7. */
@Controller('audit')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Rota estática antes da raiz com filtros (mesma regra da 1.3).
  @Get('export')
  @Roles(UserRole.MANAGER)
  async export(@Query() query: QueryAuditDto, @Res({ passthrough: true }) res: Response) {
    const csv = await this.auditService.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
    return csv;
  }

  @Get()
  @Roles(UserRole.MANAGER)
  list(@Query() query: QueryAuditDto) {
    return this.auditService.list(query);
  }
}
```

Create `backend/src/modules/audit/audit.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { AuditController } from './audit.controller';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

@Module({
  // Company: exigida pelo SubscriptionGuard do controller.
  imports: [TypeOrmModule.forFeature([AuditLog, Company])],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
```

Modify `backend/src/database/entities.ts`: importar `AuditLog` de `../modules/audit/audit-log.entity` e
acrescentá-lo ao fim de `ENTITIES`. Modify `backend/src/database/entities.spec.ts`: `9` ⇒ `10` (título e
as duas asserções). Modify `backend/src/app.module.ts`: importar `AuditModule` e acrescentá-lo ao
`imports` do módulo raiz, junto dos outros módulos de negócio.

- [ ] **Step 4: Rodar, checar e commit**

```bash
npm run test:int -- src/modules/audit/audit.http.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/audit src/database/entities.ts src/database/entities.spec.ts src/app.module.ts
git commit -m "feat(backend): API da auditoria (GET /audit com filtros e exportação CSV)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 12 (3 + 7 + 1 + 1); unitário 22/153; integração 21/130; `tsc exit=0`.

---

### Task 6: Registro do andamento

**Files:** Modify `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md` (fim da seção 2)
e `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10).

- [ ] **Step 1: Registrar**

No spec do SP2, ao fim da seção 2.7 (antes de `**Pronto quando:**` da seção 2):
```markdown
**Divisão da etapa (2026-09-24):** 2.1.1 = backend; 2.1.2 = web (página Auditoria + gaveta Histórico).
**Resultado da 2.1.1 (<data>):** migrations `1700000015000-AuditLog` (tabela append-only com RLS e
`audit_insert`) e `1700000016000-AuditTriggers` (trigger nas 7 tabelas); middleware define `app.audit_source`
(web/mobile pelo User-Agent), `app.request_id` (+ cabeçalho `X-Request-Id`) e `app.client_ip`; eventos de
login/falha e resumo de importação; `GET /audit` e `/audit/export` (CSV). **Decisões da execução:** variável
`app.audit_source` própria (a `app.change_source` é do histórico de preço); `audit_insert` grava com a
empresa da linha mesmo fora de contexto de tenant; empresa inexistente não audita (exclusão em cascata);
coluna `entityLabel`; falha ao auditar login não derruba o login.
```
E, na seção 10 do mestre, a linha do SP2: "2.1.1 (backend da auditoria) executada em <data> (branch
feat/cadastros-sp2-etapa-2-1-1)", link do plano, baselines de backend.

- [ ] **Step 2: Checagem final e commit**

```bash
cd /c/PROJETOS/SAAS/backend
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
cd /c/PROJETOS/SAAS && git add docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "docs: andamento do SP2 — sub-etapa 2.1.1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Banco de desenvolvimento:** as migrations 15000/16000 só entram em `inventory_saas` com autorização do
usuário (perguntar ao fim).

---

## Auto-revisão

**Cobertura do spec (seção 2 — backend):** tabela e colunas (2.2) → Task 1 (+ `entityLabel`); índices,
RLS, append-only, cascata → Tasks 1 e 2; trigger genérico, diff, máscara de senha, ações, colunas ignoradas,
empresa/master_admin, contexto, modo resumo, `search_path` (2.3) → Task 2; middleware e worker (2.4) →
Tasks 3 e 4; eventos explícitos de login e importação (2.5) → Task 4; API e CSV (2.6) → Task 5. Telas (2.6)
→ 2.1.2. Testes da 2.7 → distribuídos (integração por tabela, append-only, RLS, cascata, filtros/400, CSV,
`X-Request-Id`, mobile × web).

**Review Focus:** 1 e 2 → Task 2 (+ Task 1 "fora de contexto de tenant"); 3 → Task 3; 4 → Task 2; 5 → Task 5.

**Decisões novas (Global Constraints):** `app.audit_source`; empresa da linha no `audit_insert`; empresa
inexistente não audita; `entityLabel`; login não derrubado por falha de auditoria.

**Placeholders:** `<data>` na Task 6 é preenchido na execução.

**Consistência:** `audit_insert(uuid, text, uuid, text, text, jsonb, jsonb)` (Task 1) chamado com 7
argumentos pelo trigger (Task 2) e por `recordAuditEvent` (Task 4); `auditSourceFromUserAgent`/`AuditSource`
(Task 3) usados na Task 4; `AUDIT_ENTITY_TYPES`/`AUDIT_ACTIONS` (Task 5) batem com os `CHECK`/tipos das
Tasks 1 e 2.

# SP2 — Sub-etapa 2.2.1: Justificativa e aprovações (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mudanças sensíveis (preço/custo acima de X%, editar/excluir perda, arquivar produto com perdas)
passam a exigir **justificativa** (empresa com 1 gerente) ou **aprovação de outro gerente** (2+ gerentes),
conforme políticas por empresa, com fila de pedidos, aprovação/recusa/cancelamento e auditoria de cada passo.

**Architecture:** Uma migration cria `companies.approvalPolicies` e a tabela `change_requests` (RLS).
Funções puras (`approval-policies.ts`) decidem sensibilidade e modo; um "portão" sem DI (`approval-gate.ts`,
lê o contexto de tenant) é chamado pelos serviços de Produtos e Perdas **antes** de gravar: devolve `null`
(segue, com `app.audit_reason` definido) ou um pedido pendente (nada é gravado ⇒ HTTP 202), ou lança 409
`JUSTIFICATION_REQUIRED`. `ApprovalsService` (injeta `ProductsService`/`LossesService` — sem ciclo, pois os
serviços usam o portão por função) lista, aprova (reaplica o payload pelo **mesmo método** com
`skipPolicy`), recusa e cancela. Políticas editadas por `GET/PUT /approval-policies`.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL 16 (RLS), class-validator, Jest (unit `npm test`,
integração `npm run test:int` com Postgres real).

**Spec:** `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md`, seção 3 (3.1–3.4 e
3.6; as telas da 3.5 ficam na sub-etapa 2.2.2 — web). A política `retro_fix` é só criada/configurável aqui;
quem a usa é a etapa 2.3.

## Global Constraints

- Políticas (chaves exatas): `price_change` (`thresholdPercent`, padrão **20**), `retro_fix`, `loss_edit`,
  `archive_with_history`. Todas **desligadas** por padrão. Importação não passa por política.
- `price_change`: edição manual que muda `unitPrice` ou `costPrice` em **mais de** X% — só quando o valor
  anterior é **> 0**.
- Modo: **≥ 2 gerentes ativos ⇒ aprovação**; senão ⇒ justificativa. Gerente inativo não conta.
- Sem justificativa num caso que exige: `409 { errorCode: 'JUSTIFICATION_REQUIRED', policy, mode }`.
  Justificativa: campo `justification`, **mín. 10 caracteres** (menor ⇒ 400), máx. 1000.
- Aprovação: `202 { status: 'pending', changeRequestId, policy }`; nada é gravado na entidade.
- Endpoints afetados: `PATCH /products/:id`, `DELETE /products/:id`, `PATCH /losses/:id`, `DELETE /losses/:id`
  (o da correção retroativa entra na 2.3).
- `change_requests.status` ∈ `pending|approved|rejected|expired|cancelled`; `expiresAt` = criação + 7 dias;
  expiração **preguiçosa** (ao listar/decidir, sem job).
- Quem pediu não aprova nem recusa (403 `SELF_APPROVAL`); pode cancelar enquanto pendente.
- Aprovar reaplica pelo mesmo método de serviço; se o registro mudou desde o pedido (campos do `snapshot`
  diferentes) ⇒ não aplica, marca `expired` com nota "O registro mudou desde o pedido.".
- Um pendente por entidade+política: pedir de novo **cancela** o anterior.
- Auditoria: `request` na criação (entityType `change_request`), `approve`/`reject` na decisão, `justify` no
  modo justificativa; a mudança aplicada aparece pelo trigger com `reason` = justificativa original.
- RLS no molde do SP1: `TENANT_COMPANY_ID_PREDICATE` de `src/database/helpers/rls.ts`; role de runtime com
  SELECT/INSERT/UPDATE em `change_requests` (sem DELETE).
- Nova migration: `1700000017000`. Entidade nova vai em `src/database/entities.ts` (`ENTITIES`).
- Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Variação exatamente no limite** (10,00 → 12,00 com 20%) ⇒ não é sensível; 10,00 → 12,01 é. Aritmética
   em ponto flutuante não pode inverter a borda. → Task 2, testes de borda.
2. **Aprovar depois de alguém editar o mesmo produto** ⇒ não aplica, pedido `expired` com a nota, produto
   intacto — e a marcação `expired` **persiste** (não pode ser desfeita por rollback de erro). → Task 5.
3. **Pedido de outra empresa** (id válido) ⇒ 404 para o gerente de outra empresa, nunca aprovável. → Task 5.
4. **Justificativa vazia/curta** (`"   "`, 9 caracteres) ⇒ 400, não grava. → Task 3.
5. **Aprovação que falha na reaplicação** (ex.: código de barras que passou a conflitar) ⇒ erro devolvido ao
   aprovador e pedido **continua pendente** (rollback da transação). → Task 5.

---

## Estrutura de arquivos

- Create `backend/src/database/migrations/1700000017000-ApprovalRequests.ts`, `backend/src/database/approval-requests.int-spec.ts`
- Create `backend/src/modules/approvals/change-request.entity.ts`
- Create `backend/src/modules/approvals/approval-policies.ts`, `approval-policies.spec.ts`
- Create `backend/src/modules/approvals/approval-gate.ts`
- Create `backend/src/modules/approvals/dto/justification.dto.ts`, `dto/decision.dto.ts`, `dto/list-change-requests.dto.ts`, `dto/update-approval-policies.dto.ts`
- Create `backend/src/modules/approvals/approvals.service.ts`, `approvals.controller.ts`, `approval-policies.controller.ts`, `approvals.module.ts`
- Create `backend/src/test-utils/approvals-test-app.ts` (app Nest de teste com os 4 controllers)
- Create `backend/src/modules/approvals/approvals-products.http.int-spec.ts`, `approvals-losses.http.int-spec.ts`, `change-requests.http.int-spec.ts`, `approval-policies.http.int-spec.ts`
- Modify `backend/src/modules/companies/company.entity.ts`, `backend/src/database/entities.ts`, `entities.spec.ts`, `backend/src/app.module.ts`
- Modify `backend/src/modules/products/products.service.ts`, `products.controller.ts`, `dto/update-product.dto.ts`, `products.service.spec.ts`
- Modify `backend/src/modules/losses/losses.service.ts`, `losses.controller.ts`, `dto/update-loss.dto.ts`, `losses.service.spec.ts`

---

### Task 1: Migration, entidade `ChangeRequest` e coluna `approvalPolicies`

**Files:**
- Create: `backend/src/database/migrations/1700000017000-ApprovalRequests.ts`
- Create: `backend/src/database/approval-requests.int-spec.ts`
- Create: `backend/src/modules/approvals/change-request.entity.ts`
- Modify: `backend/src/modules/companies/company.entity.ts`, `backend/src/database/entities.ts`, `backend/src/database/entities.spec.ts`

**Interfaces:**
- Produces: tabela `change_requests` (colunas abaixo, incl. `operation` e `entityLabel`); entidade
  `ChangeRequest`; tipo `ChangeRequestStatus = 'pending'|'approved'|'rejected'|'expired'|'cancelled'`;
  `Company.approvalPolicies: Record<string, unknown>`.

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/database/approval-requests.int-spec.ts`:
```ts
import { adminQuery, closeTestConnections, seedCompany, truncateAll, withTenant } from '../test-utils/test-db';

async function insertRequest(companyId: string): Promise<{ id: string; status: string; ttl: { days?: number } }> {
  const [row] = await adminQuery(
    `INSERT INTO change_requests ("companyId", policy, "entityType", "entityId", operation, payload, snapshot, justification)
     VALUES ($1, 'price_change', 'product', gen_random_uuid(), 'update', '{}', '{}', 'Justificativa de teste') RETURNING id, status, "expiresAt" - "createdAt" AS ttl`,
    [companyId],
  );
  return row;
}

describe('migration 1700000017000 — políticas e pedidos de aprovação', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('companies.approvalPolicies nasce como {} (tudo desligado)', async () => {
    const companyId = await seedCompany('Empresa Políticas');
    const [row] = await adminQuery(`SELECT "approvalPolicies" FROM companies WHERE id = $1`, [companyId]);
    expect(row.approvalPolicies).toEqual({});
  });

  it('pedido nasce pendente e vence em 7 dias', async () => {
    const companyId = await seedCompany('Empresa Pedido');
    const row = await insertRequest(companyId);
    expect(row.status).toBe('pending');
    expect(row.ttl).toMatchObject({ days: 7 });
  });

  it('RLS: cada empresa só enxerga os próprios pedidos', async () => {
    const a = await seedCompany('A');
    const b = await seedCompany('B');
    await insertRequest(a);
    await insertRequest(b);

    const seenByA = await withTenant({ companyId: a }, (m) => m.query(`SELECT "companyId" FROM change_requests`));
    expect(seenByA).toEqual([{ companyId: a }]);
  });

  it('role da aplicação atualiza status mas não apaga pedidos', async () => {
    const companyId = await seedCompany('Empresa Status');
    const row = await insertRequest(companyId);

    await withTenant({ companyId }, (m) => m.query(`UPDATE change_requests SET status = 'cancelled' WHERE id = $1`, [row.id]));
    expect((await adminQuery(`SELECT status FROM change_requests WHERE id = $1`, [row.id]))[0].status).toBe('cancelled');

    await expect(
      withTenant({ companyId }, (m) => m.query(`DELETE FROM change_requests WHERE id = $1`, [row.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it('só um pedido pendente por entidade + política', async () => {
    const companyId = await seedCompany('Empresa Único');
    const entityId = (await adminQuery(`SELECT gen_random_uuid() AS id`))[0].id;
    const insert = () =>
      adminQuery(
        `INSERT INTO change_requests ("companyId", policy, "entityType", "entityId", operation, payload, snapshot, justification)
         VALUES ($1, 'loss_edit', 'loss', $2, 'update', '{}', '{}', 'Justificativa de teste')`,
        [companyId, entityId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('status e política fora da lista são recusados', async () => {
    const companyId = await seedCompany('Empresa Check');
    await expect(
      adminQuery(
        `INSERT INTO change_requests ("companyId", policy, "entityType", operation, payload, snapshot, justification)
         VALUES ($1, 'qualquer', 'product', 'update', '{}', '{}', 'Justificativa de teste')`,
        [companyId],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
```

Modify `backend/src/database/entities.spec.ts`: `10` ⇒ `11` (título e as duas asserções).

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /c/PROJETOS/SAAS/backend
npm run test:int -- src/database/approval-requests.int-spec.ts
npx jest src/database/entities.spec.ts
```
Expected: integração FAIL (`column "approvalPolicies" does not exist` / `relation "change_requests" does not
exist`); unitário FAIL (`expected length 11, received 10`).

- [ ] **Step 3: Implementar**

Create `backend/src/database/migrations/1700000017000-ApprovalRequests.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE } from '../helpers/rls';

/**
 * SP2, etapa 2.2 — políticas de aprovação por empresa e fila de pedidos. `operation` e `entityLabel` não
 * estão na lista do spec (3.4): `operation` diz qual método reaplicar na aprovação (update/archive/delete) e
 * `entityLabel` guarda o nome legível do registro para a fila e a auditoria.
 */
export class ApprovalRequests1700000017000 implements MigrationInterface {
  name = 'ApprovalRequests1700000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" ADD COLUMN "approvalPolicies" jsonb NOT NULL DEFAULT '{}'::jsonb`);

    await queryRunner.query(`
      CREATE TABLE "change_requests" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId"         uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "policy"            varchar(30) NOT NULL
                            CHECK ("policy" IN ('price_change','retro_fix','loss_edit','archive_with_history')),
        "entityType"        varchar(40) NOT NULL,
        "entityId"          uuid NULL,
        "entityLabel"       varchar(200) NULL,
        "operation"         varchar(20) NOT NULL,
        "payload"           jsonb NOT NULL,
        "snapshot"          jsonb NOT NULL,
        "justification"     text NOT NULL,
        "status"            varchar(20) NOT NULL DEFAULT 'pending'
                            CHECK ("status" IN ('pending','approved','rejected','expired','cancelled')),
        "requestedByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "decidedByUserId"   uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "decidedAt"         timestamptz NULL,
        "decisionNote"      text NULL,
        "expiresAt"         timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
        "createdAt"         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_change_requests_company_status" ON "change_requests" ("companyId", "status", "createdAt" DESC)`,
    );
    // Um pendente por entidade + política (spec 3.4): pedir de novo cancela o anterior antes de inserir.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_change_requests_one_pending"
        ON "change_requests" ("companyId", "entityType", "entityId", "policy") WHERE "status" = 'pending'
    `);

    await queryRunner.query(`ALTER TABLE "change_requests" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "change_requests" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_change_requests" ON "change_requests"
      USING (${TENANT_COMPANY_ID_PREDICATE})
      WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
    `);
    // O app atualiza o status, mas nunca apaga um pedido (o histórico de decisões é parte da auditoria).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'REVOKE DELETE, TRUNCATE ON "change_requests" FROM inventory_saas_app';
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON "change_requests" TO inventory_saas_app';
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "change_requests"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "approvalPolicies"`);
  }
}
```

Create `backend/src/modules/approvals/change-request.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

/** Pedido de mudança sensível aguardando outro gerente (SP2, etapa 2.2 — migration 1700000017000). */
@Entity('change_requests')
export class ChangeRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) companyId: string;
  @Column({ type: 'varchar', length: 30 }) policy: string;
  @Column({ type: 'varchar', length: 40 }) entityType: string;
  @Column({ type: 'uuid', nullable: true }) entityId: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) entityLabel: string | null;
  @Column({ type: 'varchar', length: 20 }) operation: string;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;
  @Column({ type: 'text' }) justification: string;
  @Column({ type: 'varchar', length: 20, default: 'pending' }) status: ChangeRequestStatus;
  @Column({ type: 'uuid', nullable: true }) requestedByUserId: string | null;
  @Column({ type: 'uuid', nullable: true }) decidedByUserId: string | null;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date | null;
  @Column({ type: 'text', nullable: true }) decisionNote: string | null;
  @Column({ type: 'timestamptz', insert: false }) expiresAt: Date;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
```

Modify `backend/src/modules/companies/company.entity.ts` — acrescentar, junto das outras colunas (antes de
`createdAt`):
```ts
  // Políticas de aprovação (SP2, 2.2 — migration 1700000017000). Normalizadas por approval-policies.ts.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  approvalPolicies: Record<string, unknown>;
```

Modify `backend/src/database/entities.ts`: importar `ChangeRequest` de
`../modules/approvals/change-request.entity` e acrescentá-lo ao fim de `ENTITIES`.

- [ ] **Step 4: Rodar, checar e commit**

```bash
npm run test:int -- src/database/approval-requests.int-spec.ts
npx jest src/database/entities.spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/database/migrations/1700000017000-ApprovalRequests.ts src/database/approval-requests.int-spec.ts src/modules/approvals/change-request.entity.ts src/modules/companies/company.entity.ts src/database/entities.ts src/database/entities.spec.ts
git commit -m "feat(backend): políticas de aprovação por empresa e tabela change_requests (RLS)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 6 e 3; todas as suítes verdes; `tsc exit=0`.

---

### Task 2: Regras puras — sensibilidade de preço, modo e normalização

**Files:**
- Create: `backend/src/modules/approvals/approval-policies.ts`, `backend/src/modules/approvals/approval-policies.spec.ts`

**Interfaces:**
- Produces: `APPROVAL_POLICY_KEYS`, `type ApprovalPolicyKey`, `DEFAULT_PRICE_THRESHOLD_PERCENT = 20`,
  `interface ApprovalPolicies { price_change: { enabled: boolean; thresholdPercent: number }; retro_fix: {
  enabled: boolean }; loss_edit: { enabled: boolean }; archive_with_history: { enabled: boolean } }`,
  `normalizePolicies(raw: unknown): ApprovalPolicies`, `priceChangeExceeds(before: { unitPrice: number |
  string; costPrice: number | string }, after: { unitPrice?: number; costPrice?: number }, thresholdPercent:
  number): boolean`, `type ApprovalMode = 'approval' | 'justification'`, `approvalModeFor(activeManagers:
  number): ApprovalMode`.

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/modules/approvals/approval-policies.spec.ts`:
```ts
import { approvalModeFor, normalizePolicies, priceChangeExceeds } from './approval-policies';

describe('priceChangeExceeds', () => {
  const before = { unitPrice: '10.00', costPrice: '6.00' };

  it('exatamente no limite não é sensível; um centavo acima é', () => {
    expect(priceChangeExceeds(before, { unitPrice: 12 }, 20)).toBe(false);
    expect(priceChangeExceeds(before, { unitPrice: 12.01 }, 20)).toBe(true);
    expect(priceChangeExceeds(before, { unitPrice: 8 }, 20)).toBe(false);
    expect(priceChangeExceeds(before, { unitPrice: 7.99 }, 20)).toBe(true);
  });

  it('decimais que enganam o ponto flutuante (0,10 → 0,12 com 20%) não viram sensíveis', () => {
    expect(priceChangeExceeds({ unitPrice: '0.10', costPrice: '0' }, { unitPrice: 0.12 }, 20)).toBe(false);
  });

  it('custo também conta; campo ausente no DTO não conta', () => {
    expect(priceChangeExceeds(before, { costPrice: 9 }, 20)).toBe(true);
    expect(priceChangeExceeds(before, {}, 20)).toBe(false);
  });

  it('valor anterior zero nunca é sensível (preencher preço zerado)', () => {
    expect(priceChangeExceeds({ unitPrice: '0.00', costPrice: '0.00' }, { unitPrice: 50, costPrice: 30 }, 20)).toBe(false);
  });
});

describe('approvalModeFor', () => {
  it('0 ou 1 gerente ⇒ justificativa; 2 ou mais ⇒ aprovação', () => {
    expect(approvalModeFor(0)).toBe('justification');
    expect(approvalModeFor(1)).toBe('justification');
    expect(approvalModeFor(2)).toBe('approval');
    expect(approvalModeFor(5)).toBe('approval');
  });
});

describe('normalizePolicies', () => {
  it('vazio ⇒ tudo desligado e limite padrão 20', () => {
    expect(normalizePolicies({})).toEqual({
      price_change: { enabled: false, thresholdPercent: 20 },
      retro_fix: { enabled: false },
      loss_edit: { enabled: false },
      archive_with_history: { enabled: false },
    });
    expect(normalizePolicies(null)).toEqual(normalizePolicies({}));
  });

  it('mantém o que foi ligado e ignora lixo', () => {
    const policies = normalizePolicies({
      price_change: { enabled: true, thresholdPercent: 35 },
      loss_edit: { enabled: 'sim' },
      desconhecida: { enabled: true },
    });
    expect(policies.price_change).toEqual({ enabled: true, thresholdPercent: 35 });
    expect(policies.loss_edit.enabled).toBe(false);
    expect(Object.keys(policies)).toEqual(['price_change', 'retro_fix', 'loss_edit', 'archive_with_history']);
  });

  it('limite inválido volta ao padrão', () => {
    expect(normalizePolicies({ price_change: { enabled: true, thresholdPercent: -5 } }).price_change.thresholdPercent).toBe(20);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/approvals/approval-policies.spec.ts`
Expected: FAIL — `Cannot find module './approval-policies'`.

- [ ] **Step 3: Implementar**

Create `backend/src/modules/approvals/approval-policies.ts`:
```ts
/** Políticas de aprovação (SP2, etapa 2.2 — spec seção 3.1). Todas desligadas por padrão. */
export const APPROVAL_POLICY_KEYS = ['price_change', 'retro_fix', 'loss_edit', 'archive_with_history'] as const;
export type ApprovalPolicyKey = (typeof APPROVAL_POLICY_KEYS)[number];

export const DEFAULT_PRICE_THRESHOLD_PERCENT = 20;

export interface ApprovalPolicies {
  price_change: { enabled: boolean; thresholdPercent: number };
  retro_fix: { enabled: boolean };
  loss_edit: { enabled: boolean };
  archive_with_history: { enabled: boolean };
}

export type ApprovalMode = 'approval' | 'justification';

/** Lê o jsonb gravado em companies.approvalPolicies de forma tolerante: o que não for válido fica desligado. */
export function normalizePolicies(raw: unknown): ApprovalPolicies {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, { enabled?: unknown; thresholdPercent?: unknown }>;
  const enabled = (key: ApprovalPolicyKey) => source[key]?.enabled === true;
  const threshold = Number(source.price_change?.thresholdPercent);
  return {
    price_change: {
      enabled: enabled('price_change'),
      thresholdPercent: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_PRICE_THRESHOLD_PERCENT,
    },
    retro_fix: { enabled: enabled('retro_fix') },
    loss_edit: { enabled: enabled('loss_edit') },
    archive_with_history: { enabled: enabled('archive_with_history') },
  };
}

function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

/**
 * "Mais de X%" em relação ao valor anterior, só quando o anterior é > 0 (preencher preço zerado não é
 * sensível). Em centavos inteiros: com ponto flutuante, 10 → 12 dá 20,000000000000004% e viraria sensível.
 */
export function priceChangeExceeds(
  before: { unitPrice: number | string; costPrice: number | string },
  after: { unitPrice?: number; costPrice?: number },
  thresholdPercent: number,
): boolean {
  const exceeds = (previous: number | string, next: number | undefined) => {
    if (next === undefined) return false;
    const previousCents = toCents(previous);
    if (!(previousCents > 0)) return false;
    return Math.abs(toCents(next) - previousCents) * 100 > thresholdPercent * previousCents;
  };
  return exceeds(before.unitPrice, after.unitPrice) || exceeds(before.costPrice, after.costPrice);
}

/** U1: com 2+ gerentes ativos, outro gerente aprova; com 1 (ou nenhum), basta a justificativa. */
export function approvalModeFor(activeManagers: number): ApprovalMode {
  return activeManagers >= 2 ? 'approval' : 'justification';
}
```

- [ ] **Step 4: Rodar e commit**

```bash
npx jest src/modules/approvals/approval-policies.spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/approvals/approval-policies.ts src/modules/approvals/approval-policies.spec.ts
git commit -m "feat(backend): regras de sensibilidade de preço e modo de aprovação" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 9; suíte unitária verde; `tsc exit=0`.

---

### Task 3: Portão de aprovação e Produtos (editar preço, arquivar com perdas)

**Files:**
- Create: `backend/src/modules/approvals/approval-gate.ts`, `backend/src/modules/approvals/dto/justification.dto.ts`
- Create: `backend/src/test-utils/approvals-test-app.ts`, `backend/src/modules/approvals/approvals-products.http.int-spec.ts`
- Modify: `backend/src/modules/products/products.service.ts`, `products.controller.ts`, `dto/update-product.dto.ts`, `products.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 (tabela, colunas), Task 2 (`normalizePolicies`, `priceChangeExceeds`, `approvalModeFor`,
  `ApprovalPolicyKey`, `ApprovalPolicies`); `recordAuditEvent` (`src/modules/audit/audit-events.ts`).
- Produces (`approval-gate.ts`): `interface PendingApproval { status: 'pending'; changeRequestId: string;
  policy: ApprovalPolicyKey }`, `isPendingApproval(value: unknown): value is PendingApproval`, `interface
  GateOptions { skipPolicy?: boolean }`, `loadCompanyPolicies(): Promise<ApprovalPolicies>`,
  `saveCompanyPolicies(policies: ApprovalPolicies): Promise<void>`, `countActiveManagers(): Promise<number>`,
  `applyApprovalGate(input: GateInput): Promise<PendingApproval | null>` com `interface GateInput { policy;
  entityType: string; entityId: string; entityLabel: string | null; operation: 'update' | 'archive' |
  'delete'; payload: Record<string, unknown>; snapshot: Record<string, unknown>; justification?: string }`.
  `JustificationDto { justification?: string }`. De `products.service.ts`: `productSnapshot(product:
  Product): Record<string, unknown>`; `ProductsService.update(id, dto, options?: GateOptions): Promise<Product
  | PendingApproval>`; `ProductsService.remove(id, justification?: string, options?: GateOptions):
  Promise<PendingApproval | void>`. De `approvals-test-app.ts`: `startApprovalsApp()`, `http()`,
  `tokenFor()`, `seedUser()`, `seedLoss()`, `setPolicies()`, `APPROVAL_TEST_JWT_SECRET`.

- [ ] **Step 1: App de teste e testes HTTP (vão falhar)**

Create `backend/src/test-utils/approvals-test-app.ts`:
```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { TenantContextMiddleware } from '../common/tenant/tenant-context.middleware';
import { LossesController } from '../modules/losses/losses.controller';
import { LossesService } from '../modules/losses/losses.service';
import { ProductsController } from '../modules/products/products.controller';
import { ProductsService } from '../modules/products/products.service';
import { UserRole } from '../modules/users/user.entity';
import { adminQuery, appDataSource } from './test-db';

export const APPROVAL_TEST_JWT_SECRET = 'segredo-somente-de-teste';

/**
 * App Nest real para os testes de aprovação (SP2, 2.2.1): controllers de Produtos e Perdas e — a partir da
 * Task 5 — os de aprovação, com o TenantContextMiddleware real. Só o SubscriptionGuard é trocado.
 */
export async function startApprovalsApp(
  extra: { controllers?: any[]; providers?: any[] } = {},
): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProductsController, LossesController, ...(extra.controllers ?? [])],
    providers: [ProductsService, LossesService, ...(extra.providers ?? [])],
  })
    .overrideGuard(SubscriptionGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const middleware = new TenantContextMiddleware(new JwtService({ secret: APPROVAL_TEST_JWT_SECRET }), await appDataSource());
  app.use((req: Request, res: Response, next: NextFunction) => void middleware.use(req, res, next));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

export function tokenFor(userId: string, companyId: string, role: UserRole = UserRole.MANAGER): Promise<string> {
  return new JwtService({ secret: APPROVAL_TEST_JWT_SECRET }).signAsync({ sub: userId, role, companyId });
}

export async function http(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

let userCounter = 0;
export async function seedUser(
  companyId: string,
  role: 'manager' | 'employee' = 'manager',
  options: { isActive?: boolean; name?: string } = {},
): Promise<string> {
  userCounter += 1;
  return (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId", "isActive") VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id`,
      [options.name ?? `Gerente ${userCounter}`, `u${userCounter}-${companyId}@teste.local`, role, companyId, options.isActive ?? true],
    )
  )[0].id;
}

export async function seedLoss(companyId: string, productId: string, reportedByUserId: string): Promise<string> {
  const reasonId = (await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId]))[0].id;
  const locationId = (await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId]))[0].id;
  return (
    await adminQuery(
      `INSERT INTO losses ("companyId","clientGeneratedId","productId","reportedByUserId","locationId","reasonId","occurredAt","quantity")
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now(), 2) RETURNING id`,
      [companyId, productId, reportedByUserId, locationId, reasonId],
    )
  )[0].id;
}

export async function setPolicies(companyId: string, policies: Record<string, unknown>): Promise<void> {
  await adminQuery(`UPDATE companies SET "approvalPolicies" = $1::jsonb WHERE id = $2`, [JSON.stringify(policies), companyId]);
}
```
(Se o `INSERT INTO losses` falhar por `unitPriceAtLoss` nulo, conferir em `src/database/loss-valuation-snapshot.int-spec.ts`
como os testes existentes inserem perdas e copiar as colunas de valor — `"unitPriceAtLoss","unitCostAtLoss"` com
`0, 0` — sem mudar nada em produção.)

Create `backend/src/modules/approvals/approvals-products.http.int-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, setPolicies, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';

const JUSTIFICATION = 'Fornecedor reajustou a tabela';

describe('Aprovações — Produtos (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerId: string;
  let token: string;
  let productId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Aprovações');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
    productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz', unitPrice: 10, costPrice: 6 });
  });

  const priceOf = async () => (await adminQuery(`SELECT "unitPrice" FROM products WHERE id = $1`, [productId]))[0].unitPrice;

  it('política desligada: mudança grande passa sem justificativa', async () => {
    const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 50 });
    expect(status).toBe(200);
    expect(await priceOf()).toBe('50.00');
  });

  describe('com price_change ligada e 1 gerente (modo justificativa)', () => {
    beforeEach(() => setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 20 } }));

    it('sem justificativa ⇒ 409 JUSTIFICATION_REQUIRED e nada muda', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15 });
      expect(status).toBe(409);
      expect(body).toMatchObject({ errorCode: 'JUSTIFICATION_REQUIRED', policy: 'price_change', mode: 'justification' });
      expect(await priceOf()).toBe('10.00');
    });

    it('com justificativa ⇒ 200, grava e a auditoria leva o motivo (+ evento justify)', async () => {
      const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });
      expect(status).toBe(200);
      expect(await priceOf()).toBe('15.00');
      const rows = await adminQuery(
        `SELECT action, reason FROM audit_log WHERE "entityId" = $1 AND action IN ('update','justify') ORDER BY seq`,
        [productId],
      );
      expect(rows).toEqual([
        { action: 'justify', reason: JUSTIFICATION },
        { action: 'update', reason: JUSTIFICATION },
      ]);
    });

    it('variação dentro do limite e preço anterior zero não pedem nada', async () => {
      expect((await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 12 })).status).toBe(200);
      const zeroId = await seedProduct({ companyId, barcode: '2', name: 'Novo', unitPrice: 0 });
      expect((await http(baseUrl, 'PATCH', `/api/products/${zeroId}`, token, { unitPrice: 99 })).status).toBe(200);
    });

    it('justificativa curta ou só espaços ⇒ 400', async () => {
      for (const justification of ['curta', '          ']) {
        const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification });
        expect(status).toBe(400);
      }
      expect(await priceOf()).toBe('10.00');
    });
  });

  describe('com 2 gerentes ativos (modo aprovação)', () => {
    beforeEach(async () => {
      await seedUser(companyId);
      await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 20 }, archive_with_history: { enabled: true } });
    });

    it('sem justificativa ⇒ 409 com mode approval', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15 });
      expect(status).toBe(409);
      expect(body.mode).toBe('approval');
    });

    it('com justificativa ⇒ 202 pendente, produto intacto, pedido e evento "request" gravados', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });

      expect(status).toBe(202);
      expect(body).toMatchObject({ status: 'pending', policy: 'price_change' });
      expect(await priceOf()).toBe('10.00');
      const [request] = await adminQuery(`SELECT * FROM change_requests WHERE id = $1`, [body.changeRequestId]);
      expect(request).toMatchObject({
        status: 'pending',
        entityType: 'product',
        entityId: productId,
        entityLabel: 'Arroz',
        operation: 'update',
        payload: { unitPrice: 15 },
        justification: JUSTIFICATION,
        requestedByUserId: managerId,
      });
      expect(request.snapshot).toMatchObject({ unitPrice: '10.00', name: 'Arroz' });
      const [event] = await adminQuery(`SELECT action, reason FROM audit_log WHERE "entityId" = $1`, [body.changeRequestId]);
      expect(event).toEqual({ action: 'request', reason: JUSTIFICATION });
    });

    it('um gerente inativo não conta: 1 ativo + 1 inativo ⇒ modo justificativa', async () => {
      await adminQuery(`UPDATE users SET "isActive" = false WHERE id <> $1 AND "companyId" = $2`, [managerId, companyId]);
      const { status } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });
      expect(status).toBe(200);
    });

    it('pedir de novo cancela o pedido pendente anterior', async () => {
      const first = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 15, justification: JUSTIFICATION });
      const second = await http(baseUrl, 'PATCH', `/api/products/${productId}`, token, { unitPrice: 16, justification: JUSTIFICATION });

      const rows = await adminQuery(`SELECT id, status FROM change_requests ORDER BY "createdAt"`);
      expect(rows).toEqual([
        { id: first.body.changeRequestId, status: 'cancelled' },
        { id: second.body.changeRequestId, status: 'pending' },
      ]);
    });

    it('arquivar produto COM perdas ⇒ 409, depois 202 e o produto segue ativo; SEM perdas ⇒ 204', async () => {
      await seedLoss(companyId, productId, managerId);
      expect((await http(baseUrl, 'DELETE', `/api/products/${productId}`, token)).status).toBe(409);
      const pending = await http(baseUrl, 'DELETE', `/api/products/${productId}`, token, { justification: JUSTIFICATION });
      expect(pending.status).toBe(202);
      expect(pending.body.policy).toBe('archive_with_history');
      expect((await adminQuery(`SELECT "isActive" FROM products WHERE id = $1`, [productId]))[0].isActive).toBe(true);

      const cleanId = await seedProduct({ companyId, barcode: '3', name: 'Sem perdas' });
      expect((await http(baseUrl, 'DELETE', `/api/products/${cleanId}`, token)).status).toBe(204);
    });
  });
});
```

Modify `backend/src/modules/products/products.service.spec.ts`: em **todo** `manager` simulado usado por
testes que chamam `update(...)` ou `remove(...)`, acrescentar
`query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),` (a checagem de política lê
`companies.approvalPolicies` pelo `manager.query`; `{}` = tudo desligado, comportamento de antes).

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:int -- src/modules/approvals/approvals-products.http.int-spec.ts
```
Expected: FAIL — o teste da política desligada passa (é guarda); os demais falham (200 em vez de 409/202;
`justification` recusado com 400 por `forbidNonWhitelisted`).

- [ ] **Step 3: Implementar**

Create `backend/src/modules/approvals/dto/justification.dto.ts`:
```ts
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Justificativa de mudança sensível (SP2, 2.2): mín. 10 caracteres úteis — espaços nas pontas não contam. */
export class JustificationDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'A justificativa precisa ter pelo menos 10 caracteres.' })
  @MaxLength(1000)
  justification?: string;
}
```

Modify `backend/src/modules/products/dto/update-product.dto.ts`: `export class UpdateProductDto extends
JustificationDto {` (importar de `../../approvals/dto/justification.dto`).

Create `backend/src/modules/approvals/approval-gate.ts`:
```ts
import { ConflictException } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { recordAuditEvent } from '../audit/audit-events';
import { ApprovalPolicies, ApprovalPolicyKey, approvalModeFor, normalizePolicies } from './approval-policies';

export interface PendingApproval {
  status: 'pending';
  changeRequestId: string;
  policy: ApprovalPolicyKey;
}

export function isPendingApproval(value: unknown): value is PendingApproval {
  return !!value && typeof value === 'object' && (value as { status?: unknown }).status === 'pending'
    && typeof (value as { changeRequestId?: unknown }).changeRequestId === 'string';
}

/** `skipPolicy`: só a aprovação de um pedido usa — reaplica pelo mesmo método sem pedir aprovação de novo. */
export interface GateOptions {
  skipPolicy?: boolean;
}

export interface GateInput {
  policy: ApprovalPolicyKey;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  operation: 'update' | 'archive' | 'delete';
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  justification?: string;
}

export async function loadCompanyPolicies(): Promise<ApprovalPolicies> {
  const { companyId } = getTenantContext();
  const rows: { approvalPolicies: unknown }[] = await getTenantManager().query(
    `SELECT "approvalPolicies" FROM companies WHERE id = $1`,
    [companyId],
  );
  return normalizePolicies(rows[0]?.approvalPolicies);
}

export async function saveCompanyPolicies(policies: ApprovalPolicies): Promise<void> {
  const { companyId } = getTenantContext();
  await getTenantManager().query(`UPDATE companies SET "approvalPolicies" = $1::jsonb WHERE id = $2`, [
    JSON.stringify(policies),
    companyId,
  ]);
}

/** Gerentes ATIVOS da empresa (a RLS de users restringe à empresa da requisição). */
export async function countActiveManagers(): Promise<number> {
  const rows: { n: number }[] = await getTenantManager().query(
    `SELECT count(*)::int AS n FROM users WHERE role = 'manager' AND "isActive" = true`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Portão das mudanças sensíveis (SP2, spec 3.2–3.4). Só é chamado quando a política se aplica.
 * - sem justificativa ⇒ 409 JUSTIFICATION_REQUIRED (o painel pede o texto e reenvia);
 * - modo justificativa (1 gerente) ⇒ define app.audit_reason (vai para a linha do trigger), grava "justify"
 *   e devolve null — quem chamou segue e grava;
 * - modo aprovação (2+) ⇒ cancela o pendente anterior da mesma entidade+política, cria o pedido, grava
 *   "request" e devolve o pendente — quem chamou NÃO grava.
 */
export async function applyApprovalGate(input: GateInput): Promise<PendingApproval | null> {
  const { companyId, userId } = getTenantContext();
  const manager = getTenantManager();
  const mode = approvalModeFor(await countActiveManagers());

  if (!input.justification) {
    throw new ConflictException({
      statusCode: 409,
      errorCode: 'JUSTIFICATION_REQUIRED',
      message:
        mode === 'approval'
          ? 'Esta mudança precisa da aprovação de outro gerente. Informe a justificativa para enviar o pedido.'
          : 'Esta mudança exige uma justificativa.',
      policy: input.policy,
      mode,
    });
  }

  await manager.query(`SELECT set_config('app.audit_reason', $1, true)`, [input.justification]);

  if (mode === 'justification') {
    await recordAuditEvent(manager, {
      companyId: companyId!,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      action: 'justify',
      summary: { policy: input.policy, operation: input.operation },
    });
    return null;
  }

  await manager.query(
    `UPDATE change_requests
        SET status = 'cancelled', "decidedAt" = now(), "decisionNote" = 'Substituído por um novo pedido.'
      WHERE "entityType" = $1 AND "entityId" = $2 AND policy = $3 AND status = 'pending'`,
    [input.entityType, input.entityId, input.policy],
  );
  const [row]: { id: string }[] = await manager.query(
    `INSERT INTO change_requests
       ("companyId", policy, "entityType", "entityId", "entityLabel", operation, payload, snapshot, justification, "requestedByUserId")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10) RETURNING id`,
    [
      companyId,
      input.policy,
      input.entityType,
      input.entityId,
      input.entityLabel,
      input.operation,
      JSON.stringify(input.payload),
      JSON.stringify(input.snapshot),
      input.justification,
      userId || null,
    ],
  );
  await recordAuditEvent(manager, {
    companyId: companyId!,
    entityType: 'change_request',
    entityId: row.id,
    entityLabel: input.entityLabel,
    action: 'request',
    summary: { policy: input.policy, entityType: input.entityType, entityId: input.entityId, operation: input.operation },
  });
  return { status: 'pending', changeRequestId: row.id, policy: input.policy };
}
```

Modify `backend/src/modules/products/products.service.ts`:
- imports:
```ts
import { Loss } from '../losses/loss.entity';
import { GateOptions, PendingApproval, applyApprovalGate, loadCompanyPolicies } from '../approvals/approval-gate';
import { priceChangeExceeds } from '../approvals/approval-policies';
```
- antes da classe:
```ts
/** Campos comparados para detectar que o produto mudou entre o pedido e a aprovação (SP2, 3.4). */
export function productSnapshot(product: Product): Record<string, unknown> {
  return {
    barcode: product.barcode,
    name: product.name,
    sku: product.sku ?? null,
    unitPrice: String(product.unitPrice),
    costPrice: String(product.costPrice),
    isActive: product.isActive,
  };
}
```
- substituir o método `update` inteiro por:
```ts
  async update(id: string, dto: UpdateProductDto, options: GateOptions = {}): Promise<Product | PendingApproval> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    const barcodeChanges = !!dto.barcode && dto.barcode !== product.barcode;
    if (barcodeChanges) {
      const existing = await manager.findOne(Product, {
        where: { companyId: companyId!, barcode: dto.barcode },
      });
      if (existing) {
        throw barcodeConflict(existing);
      }
    }

    const { justification, ...changes } = dto;
    if (!options.skipPolicy) {
      const policies = await loadCompanyPolicies();
      if (
        policies.price_change.enabled &&
        priceChangeExceeds(product, changes, policies.price_change.thresholdPercent)
      ) {
        const pending = await applyApprovalGate({
          policy: 'price_change',
          entityType: 'product',
          entityId: product.id,
          entityLabel: product.name,
          operation: 'update',
          payload: { ...changes },
          snapshot: productSnapshot(product),
          justification,
        });
        if (pending) return pending;
      }
    }

    if (barcodeChanges) product.barcode = dto.barcode!;
    if (changes.name !== undefined) product.name = changes.name;
    if (changes.sku !== undefined) product.sku = changes.sku || null;
    if (changes.unitPrice !== undefined) product.unitPrice = changes.unitPrice;
    if (changes.costPrice !== undefined) product.costPrice = changes.costPrice;

    try {
      return await manager.save(product);
    } catch (error) {
      if (isBarcodeUniqueViolation(error)) throw barcodeConflict(null);
      throw error;
    }
  }
```
- substituir `remove` por:
```ts
  // Exclusão lógica (isActive = false): produtos já referenciados em perdas
  // registradas (Loss.productId tem onDelete RESTRICT) não podem ser apagados
  // de verdade sem quebrar o histórico de relatórios. Arquivar produto COM perdas pode exigir
  // justificativa/aprovação (política archive_with_history, SP2).
  async remove(id: string, justification?: string, options: GateOptions = {}): Promise<PendingApproval | void> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }
    if (!options.skipPolicy && product.isActive) {
      const policies = await loadCompanyPolicies();
      if (policies.archive_with_history.enabled && (await manager.count(Loss, { where: { productId: id } })) > 0) {
        const pending = await applyApprovalGate({
          policy: 'archive_with_history',
          entityType: 'product',
          entityId: product.id,
          entityLabel: product.name,
          operation: 'archive',
          payload: {},
          snapshot: productSnapshot(product),
          justification,
        });
        if (pending) return pending;
      }
    }
    product.isActive = false;
    await manager.save(product);
  }
```

Modify `backend/src/modules/products/products.controller.ts`:
- imports: `import { JustificationDto } from '../approvals/dto/justification.dto';` e
  `import { isPendingApproval } from '../approvals/approval-gate';`
- trocar o `update` por:
```ts
  // 202 quando a mudança virou pedido de aprovação (SP2): nada foi gravado no produto. @Res() manual porque o
  // status depende do resultado (o @HttpCode é fixo e sobrescreveria um res.status() com passthrough).
  @Patch(':id')
  @Roles(UserRole.MANAGER)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @Res() res: Response) {
    const result = await this.productsService.update(id, dto);
    res.status(isPendingApproval(result) ? HttpStatus.ACCEPTED : HttpStatus.OK).json(result);
  }
```
- trocar o `remove` (remover o `@HttpCode(HttpStatus.NO_CONTENT)`) por:
```ts
  // Exclusão lógica — ver nota em ProductsService.remove(). 204, ou 202 se virou pedido de aprovação.
  @Delete(':id')
  @Roles(UserRole.MANAGER)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Body() body: JustificationDto, @Res() res: Response) {
    const result = await this.productsService.remove(id, body?.justification);
    if (isPendingApproval(result)) {
      res.status(HttpStatus.ACCEPTED).json(result);
      return;
    }
    res.status(HttpStatus.NO_CONTENT).send();
  }
```
(conferir que `HttpCode` continua usado em outro ponto do controller; se não, tirar do import.)

- [ ] **Step 4: Rodar, checar e commit**

```bash
npm run test:int -- src/modules/approvals/approvals-products.http.int-spec.ts src/modules/products
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/approvals src/test-utils/approvals-test-app.ts src/modules/products
git commit -m "feat(backend): justificativa/aprovação ao mudar preço acima do limite e ao arquivar produto com perdas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 10 nos testes novos; os testes antigos de produtos (unitários e HTTP) seguem verdes; `tsc exit=0`.

---

### Task 4: Perdas (editar e excluir perda já registrada)

**Files:**
- Create: `backend/src/modules/approvals/approvals-losses.http.int-spec.ts`
- Modify: `backend/src/modules/losses/losses.service.ts`, `losses.controller.ts`, `dto/update-loss.dto.ts`, `losses.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`applyApprovalGate`, `loadCompanyPolicies`, `GateOptions`, `PendingApproval`,
  `isPendingApproval`, `JustificationDto`, helpers de teste).
- Produces: `lossSnapshot(loss: Loss): Record<string, unknown>`; `LossesService.update(id, dto, options?:
  GateOptions): Promise<Loss | PendingApproval>`; `LossesService.remove(id, justification?: string, options?:
  GateOptions): Promise<PendingApproval | void>`.

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/modules/approvals/approvals-losses.http.int-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, setPolicies, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';

const JUSTIFICATION = 'Quantidade lançada errada no app';

describe('Aprovações — Perdas (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerId: string;
  let token: string;
  let lossId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Perdas');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
    const productId = await seedProduct({ companyId, barcode: '1', name: 'Óleo', unitPrice: 8 });
    lossId = await seedLoss(companyId, productId, managerId);
  });

  const quantityOf = async () => (await adminQuery(`SELECT quantity FROM losses WHERE id = $1`, [lossId]))[0]?.quantity;

  it('política desligada: editar e excluir como antes', async () => {
    expect((await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3 })).status).toBe(200);
    expect((await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token)).status).toBe(204);
  });

  describe('loss_edit ligada, 1 gerente', () => {
    beforeEach(() => setPolicies(companyId, { loss_edit: { enabled: true } }));

    it('editar sem justificativa ⇒ 409; com ⇒ 200 e auditoria com o motivo', async () => {
      expect((await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3 })).status).toBe(409);
      expect(Number(await quantityOf())).toBe(2);

      const { status } = await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3, justification: JUSTIFICATION });
      expect(status).toBe(200);
      expect(Number(await quantityOf())).toBe(3);
      const [row] = await adminQuery(`SELECT reason FROM audit_log WHERE "entityId" = $1 AND action = 'update'`, [lossId]);
      expect(row.reason).toBe(JUSTIFICATION);
    });

    it('excluir sem justificativa ⇒ 409; com ⇒ 204', async () => {
      expect((await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token)).status).toBe(409);
      expect((await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token, { justification: JUSTIFICATION })).status).toBe(204);
      expect(await quantityOf()).toBeUndefined();
    });
  });

  describe('loss_edit ligada, 2 gerentes', () => {
    beforeEach(async () => {
      await seedUser(companyId);
      await setPolicies(companyId, { loss_edit: { enabled: true } });
    });

    it('editar ⇒ 202 e a perda fica como estava', async () => {
      const { status, body } = await http(baseUrl, 'PATCH', `/api/losses/${lossId}`, token, { quantity: 3, justification: JUSTIFICATION });
      expect(status).toBe(202);
      expect(body.policy).toBe('loss_edit');
      expect(Number(await quantityOf())).toBe(2);
      const [request] = await adminQuery(`SELECT operation, "entityLabel", payload FROM change_requests`);
      expect(request).toEqual({ operation: 'update', entityLabel: 'Perda de Óleo', payload: { quantity: 3 } });
    });

    it('excluir ⇒ 202 e a perda continua existindo', async () => {
      const { status } = await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, token, { justification: JUSTIFICATION });
      expect(status).toBe(202);
      expect(Number(await quantityOf())).toBe(2);
    });
  });
});
```

Modify `backend/src/modules/losses/losses.service.spec.ts`: em todo `manager` simulado dos testes de
`update(...)`/`remove(...)`, acrescentar `query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),`.
As asserções existentes de quantidade de chamadas de `findOne` continuam valendo (com a política desligada o
serviço não busca nada a mais).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/approvals/approvals-losses.http.int-spec.ts`
Expected: o teste da política desligada passa; os demais FAIL (200/204 em vez de 409/202; `justification`
dá 400 no PATCH).

- [ ] **Step 3: Implementar**

Modify `backend/src/modules/losses/dto/update-loss.dto.ts`: `export class UpdateLossDto extends JustificationDto {`
(importar de `../../approvals/dto/justification.dto`).

Modify `backend/src/modules/losses/losses.service.ts`:
- imports:
```ts
import { GateOptions, PendingApproval, applyApprovalGate, loadCompanyPolicies } from '../approvals/approval-gate';
import { EntityManager } from 'typeorm';
```
(juntar `EntityManager` ao import existente de `typeorm`.)
- antes da classe:
```ts
/** Campos comparados para detectar que a perda mudou entre o pedido e a aprovação (SP2, 3.4). */
export function lossSnapshot(loss: Loss): Record<string, unknown> {
  return {
    productId: loss.productId,
    quantity: String(loss.quantity),
    reasonId: loss.reasonId,
    locationId: loss.locationId,
    description: loss.description ?? null,
    occurredAt: new Date(loss.occurredAt).toISOString(),
  };
}

async function lossLabel(manager: EntityManager, loss: Loss): Promise<string> {
  const product = await manager.findOne(Product, { where: { id: loss.productId } });
  return `Perda de ${product?.name ?? 'produto'}`;
}
```
- em `update`: assinatura `async update(id: string, dto: UpdateLossDto, options: GateOptions = {}): Promise<Loss | PendingApproval> {`;
  logo depois do `if (!loss) throw new NotFoundException(...)`, inserir:
```ts
    const { justification, ...changes } = dto;
    if (!options.skipPolicy) {
      const policies = await loadCompanyPolicies();
      if (policies.loss_edit.enabled) {
        const pending = await applyApprovalGate({
          policy: 'loss_edit',
          entityType: 'loss',
          entityId: loss.id,
          entityLabel: await lossLabel(manager, loss),
          operation: 'update',
          payload: { ...changes },
          snapshot: lossSnapshot(loss),
          justification,
        });
        if (pending) return pending;
      }
    }
```
  (o resto do método segue lendo de `dto` — `justification` não é campo de `Loss` e não é atribuído.)
- substituir `remove` por:
```ts
  // Nenhuma outra tabela referencia losses (é um registro-folha), então a
  // exclusão é direta — sem a nuance de FK RESTRICT usada em produtos/usuários. Pode exigir
  // justificativa/aprovação (política loss_edit, SP2).
  async remove(id: string, justification?: string, options: GateOptions = {}): Promise<PendingApproval | void> {
    const manager = getTenantManager();
    if (!options.skipPolicy) {
      const policies = await loadCompanyPolicies();
      if (policies.loss_edit.enabled) {
        const loss = await manager.findOne(Loss, { where: { id } });
        if (!loss) throw new NotFoundException('Perda não encontrada.');
        const pending = await applyApprovalGate({
          policy: 'loss_edit',
          entityType: 'loss',
          entityId: loss.id,
          entityLabel: await lossLabel(manager, loss),
          operation: 'delete',
          payload: {},
          snapshot: lossSnapshot(loss),
          justification,
        });
        if (pending) return pending;
      }
    }
    const result = await manager.delete(Loss, id);
    if (result.affected === 0) {
      throw new NotFoundException('Perda não encontrada.');
    }
  }
```

Modify `backend/src/modules/losses/losses.controller.ts`:
- imports: `Res` em `@nestjs/common`; `import { Response } from 'express';`;
  `import { JustificationDto } from '../approvals/dto/justification.dto';`;
  `import { isPendingApproval } from '../approvals/approval-gate';`
- trocar `update` e `remove` por:
```ts
  @Patch(':id')
  @Roles(UserRole.MANAGER)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLossDto, @Res() res: Response) {
    const result = await this.lossesService.update(id, dto);
    res.status(isPendingApproval(result) ? HttpStatus.ACCEPTED : HttpStatus.OK).json(result);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Body() body: JustificationDto, @Res() res: Response) {
    const result = await this.lossesService.remove(id, body?.justification);
    if (isPendingApproval(result)) {
      res.status(HttpStatus.ACCEPTED).json(result);
      return;
    }
    res.status(HttpStatus.NO_CONTENT).send();
  }
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npm run test:int -- src/modules/approvals/approvals-losses.http.int-spec.ts src/modules/losses
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/approvals/approvals-losses.http.int-spec.ts src/modules/losses
git commit -m "feat(backend): justificativa/aprovação ao editar ou excluir perda registrada" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 6; suítes antigas de perdas verdes; `tsc exit=0`.

---

### Task 5: Fila de pedidos — listar, aprovar, recusar, cancelar

**Files:**
- Create: `backend/src/modules/approvals/dto/decision.dto.ts`, `dto/list-change-requests.dto.ts`
- Create: `backend/src/modules/approvals/approvals.service.ts`, `approvals.controller.ts`
- Create: `backend/src/modules/approvals/change-requests.http.int-spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 e 4 (`ChangeRequest`, `productSnapshot`, `lossSnapshot`, serviços com `skipPolicy`),
  `recordAuditEvent`.
- Produces: `ApprovalsService.list(status: 'pending' | 'decided'): Promise<ChangeRequestView[]>`,
  `pendingCount(): Promise<{ count: number }>`, `approve(id, note?): Promise<ChangeRequestView>`,
  `reject(id, note?)`, `cancel(id)`; `interface ChangeRequestView` (colunas do pedido + `requestedByName`,
  `decidedByName`). Rotas: `GET /change-requests?status=pending|decided`, `GET /change-requests/pending-count`,
  `POST /change-requests/:id/approve|reject|cancel` (corpo `{ note? }`), todas só gerente.

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/modules/approvals/change-requests.http.int-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, setPolicies, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

const JUSTIFICATION = 'Fornecedor reajustou a tabela';

describe('Fila de pedidos de aprovação (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let requesterId: string;
  let approverId: string;
  let requesterToken: string;
  let approverToken: string;
  let productId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp({ controllers: [ApprovalsController], providers: [ApprovalsService] }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Fila');
    requesterId = await seedUser(companyId, 'manager', { name: 'Ana' });
    approverId = await seedUser(companyId, 'manager', { name: 'Bruno' });
    requesterToken = await tokenFor(requesterId, companyId);
    approverToken = await tokenFor(approverId, companyId);
    productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz', unitPrice: 10, costPrice: 6 });
    await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 20 }, loss_edit: { enabled: true } });
  });

  async function requestPriceChange(unitPrice = 15): Promise<string> {
    const { status, body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, requesterToken, { unitPrice, justification: JUSTIFICATION });
    expect(status).toBe(202);
    return body.changeRequestId;
  }
  const productPrice = async () => (await adminQuery(`SELECT "unitPrice" FROM products WHERE id = $1`, [productId]))[0].unitPrice;
  const statusOf = async (id: string) => (await adminQuery(`SELECT status FROM change_requests WHERE id = $1`, [id]))[0].status;

  it('lista pendentes com quem pediu, e conta os pendentes', async () => {
    const id = await requestPriceChange();

    const { status, body } = await http(baseUrl, 'GET', '/api/change-requests?status=pending', approverToken);
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id, requestedByName: 'Ana', entityLabel: 'Arroz', payload: { unitPrice: 15 }, status: 'pending' });
    expect((await http(baseUrl, 'GET', '/api/change-requests/pending-count', approverToken)).body).toEqual({ count: 1 });
  });

  it('outro gerente aprova ⇒ aplica pelo mesmo serviço, histórico de preço "approval", auditoria com o motivo', async () => {
    const id = await requestPriceChange();

    const { status, body } = await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, { note: 'Ok, conferi a nota' });

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'approved', decidedByName: 'Bruno', decisionNote: 'Ok, conferi a nota' });
    expect(await productPrice()).toBe('15.00');
    const [history] = await adminQuery(
      `SELECT source FROM product_price_history WHERE "productId" = $1 ORDER BY seq DESC LIMIT 1`,
      [productId],
    );
    expect(history.source).toBe('approval');
    const [update] = await adminQuery(
      `SELECT "actorUserId", reason FROM audit_log WHERE "entityId" = $1 AND action = 'update'`,
      [productId],
    );
    expect(update).toEqual({ actorUserId: approverId, reason: JUSTIFICATION });
    const [approve] = await adminQuery(`SELECT reason FROM audit_log WHERE "entityId" = $1 AND action = 'approve'`, [id]);
    expect(approve.reason).toBe('Ok, conferi a nota');
  });

  it('quem pediu não aprova nem recusa (403); pode cancelar', async () => {
    const id = await requestPriceChange();

    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, requesterToken, {})).body.errorCode).toBe('SELF_APPROVAL');
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/reject`, requesterToken, {})).status).toBe(403);
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/cancel`, approverToken, {})).status).toBe(403);

    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/cancel`, requesterToken, {})).status).toBe(200);
    expect(await statusOf(id)).toBe('cancelled');
    expect(await productPrice()).toBe('10.00');
  });

  it('recusar ⇒ nada muda, status rejected e evento "reject" com a nota', async () => {
    const id = await requestPriceChange();

    const { status } = await http(baseUrl, 'POST', `/api/change-requests/${id}/reject`, approverToken, { note: 'Preço fora da tabela' });

    expect(status).toBe(200);
    expect(await statusOf(id)).toBe('rejected');
    expect(await productPrice()).toBe('10.00');
    const [event] = await adminQuery(`SELECT reason FROM audit_log WHERE "entityId" = $1 AND action = 'reject'`, [id]);
    expect(event.reason).toBe('Preço fora da tabela');
  });

  it('pedido decidido não pode ser decidido de novo (409 REQUEST_NOT_PENDING)', async () => {
    const id = await requestPriceChange();
    await http(baseUrl, 'POST', `/api/change-requests/${id}/reject`, approverToken, {});
    const { status, body } = await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, {});
    expect(status).toBe(409);
    expect(body.errorCode).toBe('REQUEST_NOT_PENDING');
  });

  it('expiração preguiçosa: vencido vira expired ao listar e não pode ser aprovado', async () => {
    const id = await requestPriceChange();
    await adminQuery(`UPDATE change_requests SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [id]);

    expect((await http(baseUrl, 'GET', '/api/change-requests?status=pending', approverToken)).body).toEqual([]);
    expect(await statusOf(id)).toBe('expired');
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, {})).status).toBe(409);
    const decided = (await http(baseUrl, 'GET', '/api/change-requests?status=decided', approverToken)).body;
    expect(decided[0]).toMatchObject({ id, status: 'expired' });
  });

  it('registro mudou desde o pedido ⇒ não aplica, fica expired com a nota (e a marcação persiste)', async () => {
    const id = await requestPriceChange();
    await adminQuery(`UPDATE products SET name = 'Arroz tipo 1' WHERE id = $1`, [productId]);

    const { status, body } = await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, approverToken, {});

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'expired', decisionNote: 'O registro mudou desde o pedido.' });
    expect(await productPrice()).toBe('10.00');
    expect(await statusOf(id)).toBe('expired');
  });

  it('reaplicação que falha (código de barras passou a conflitar) ⇒ erro e o pedido continua pendente', async () => {
    const { body } = await http(baseUrl, 'PATCH', `/api/products/${productId}`, requesterToken, {
      barcode: '999',
      unitPrice: 15,
      justification: JUSTIFICATION,
    });
    await seedProduct({ companyId, barcode: '999', name: 'Outro' });

    const { status } = await http(baseUrl, 'POST', `/api/change-requests/${body.changeRequestId}/approve`, approverToken, {});

    expect(status).toBe(409);
    expect(await statusOf(body.changeRequestId)).toBe('pending');
    expect(await productPrice()).toBe('10.00');
  });

  it('aprovar exclusão de perda apaga a perda', async () => {
    const lossId = await seedLoss(companyId, productId, requesterId);
    const { body } = await http(baseUrl, 'DELETE', `/api/losses/${lossId}`, requesterToken, { justification: JUSTIFICATION });

    expect((await http(baseUrl, 'POST', `/api/change-requests/${body.changeRequestId}/approve`, approverToken, {})).status).toBe(200);
    expect(await adminQuery(`SELECT id FROM losses WHERE id = $1`, [lossId])).toHaveLength(0);
  });

  it('gerente de outra empresa não vê nem decide (404)', async () => {
    const id = await requestPriceChange();
    const otherCompany = await seedCompany('Outra');
    const outsiderToken = await tokenFor(await seedUser(otherCompany), otherCompany);

    expect((await http(baseUrl, 'GET', '/api/change-requests?status=pending', outsiderToken)).body).toEqual([]);
    expect((await http(baseUrl, 'POST', `/api/change-requests/${id}/approve`, outsiderToken, {})).status).toBe(404);
  });

  it('funcionário não acessa a fila (403); status inválido ⇒ 400', async () => {
    const employeeToken = await tokenFor(await seedUser(companyId, 'employee'), companyId, 'employee' as never);
    expect((await http(baseUrl, 'GET', '/api/change-requests', employeeToken)).status).toBe(403);
    expect((await http(baseUrl, 'GET', '/api/change-requests?status=todos', approverToken)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/approvals/change-requests.http.int-spec.ts`
Expected: FAIL na compilação — `Cannot find module './approvals.controller'`.

- [ ] **Step 3: Implementar**

Create `backend/src/modules/approvals/dto/decision.dto.ts`:
```ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
```

Create `backend/src/modules/approvals/dto/list-change-requests.dto.ts`:
```ts
import { IsIn, IsOptional } from 'class-validator';

export class ListChangeRequestsDto {
  @IsOptional()
  @IsIn(['pending', 'decided'])
  status?: 'pending' | 'decided';
}
```

Create `backend/src/modules/approvals/approvals.service.ts`:
```ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { recordAuditEvent } from '../audit/audit-events';
import { Loss } from '../losses/loss.entity';
import { LossesService, lossSnapshot } from '../losses/losses.service';
import { Product } from '../products/product.entity';
import { ProductsService, productSnapshot } from '../products/products.service';
import { ChangeRequest, ChangeRequestStatus } from './change-request.entity';

export interface ChangeRequestView {
  id: string;
  policy: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  operation: string;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  justification: string;
  status: ChangeRequestStatus;
  requestedByUserId: string | null;
  requestedByName: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
}

const LIST_LIMIT = 200;
const VIEW_SELECT = `
  SELECT cr.id, cr.policy, cr."entityType", cr."entityId", cr."entityLabel", cr.operation, cr.payload, cr.snapshot,
         cr.justification, cr.status, cr."requestedByUserId", req.name AS "requestedByName",
         cr."decidedByUserId", dec.name AS "decidedByName", cr."decidedAt", cr."decisionNote", cr."expiresAt", cr."createdAt"
    FROM change_requests cr
    LEFT JOIN users req ON req.id = cr."requestedByUserId"
    LEFT JOIN users dec ON dec.id = cr."decidedByUserId"`;

/** Compara só as chaves gravadas no pedido (o jsonb não preserva a ordem das chaves). */
function sameSnapshot(saved: Record<string, unknown>, current: Record<string, unknown>): boolean {
  return Object.keys(saved).every((key) => JSON.stringify(saved[key]) === JSON.stringify(current[key]));
}

/**
 * Fila de pedidos de aprovação (SP2, spec 3.4). Tudo roda na transação da requisição: se a reaplicação
 * lançar, o rollback do middleware desfaz tudo e o pedido continua pendente.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly lossesService: LossesService,
  ) {}

  /** Expiração preguiçosa (sem job agendado). */
  private async expireOverdue(): Promise<void> {
    await getTenantManager().query(
      `UPDATE change_requests
          SET status = 'expired', "decidedAt" = now(), "decisionNote" = 'Prazo de 7 dias vencido.'
        WHERE status = 'pending' AND "expiresAt" < now()`,
    );
  }

  async list(status: 'pending' | 'decided' = 'pending'): Promise<ChangeRequestView[]> {
    await this.expireOverdue();
    return getTenantManager().query(
      `${VIEW_SELECT} WHERE ${status === 'pending' ? `cr.status = 'pending'` : `cr.status <> 'pending'`}
       ORDER BY COALESCE(cr."decidedAt", cr."createdAt") DESC LIMIT ${LIST_LIMIT}`,
    );
  }

  async pendingCount(): Promise<{ count: number }> {
    await this.expireOverdue();
    const rows: { n: number }[] = await getTenantManager().query(
      `SELECT count(*)::int AS n FROM change_requests WHERE status = 'pending'`,
    );
    return { count: rows[0]?.n ?? 0 };
  }

  async approve(id: string, note?: string): Promise<ChangeRequestView> {
    const { userId } = getTenantContext();
    const manager = getTenantManager();
    const request = await this.loadPendingForDecision(id);

    const current = await this.currentSnapshot(request);
    if (!current || !sameSnapshot(request.snapshot, current)) {
      // Devolve 200 com o pedido "expired": lançar um erro desfaria a marcação no rollback.
      await this.decide(request.id, 'expired', current ? 'O registro mudou desde o pedido.' : 'O registro não existe mais.', null);
      return this.findView(request.id);
    }

    // A linha do trigger leva a justificativa original; o histórico de preço registra a origem "approval".
    await manager.query(`SELECT set_config('app.audit_reason', $1, true), set_config('app.change_source', 'approval', true)`, [
      request.justification,
    ]);
    await this.apply(request);

    await manager.query(`SELECT set_config('app.audit_reason', $1, true)`, [note ?? '']);
    await this.decide(request.id, 'approved', note ?? null, userId);
    await recordAuditEvent(manager, {
      companyId: request.companyId,
      entityType: 'change_request',
      entityId: request.id,
      entityLabel: request.entityLabel,
      action: 'approve',
      summary: { policy: request.policy, entityType: request.entityType, entityId: request.entityId, operation: request.operation },
    });
    return this.findView(request.id);
  }

  async reject(id: string, note?: string): Promise<ChangeRequestView> {
    const { userId } = getTenantContext();
    const manager = getTenantManager();
    const request = await this.loadPendingForDecision(id);

    await manager.query(`SELECT set_config('app.audit_reason', $1, true)`, [note ?? '']);
    await this.decide(request.id, 'rejected', note ?? null, userId);
    await recordAuditEvent(manager, {
      companyId: request.companyId,
      entityType: 'change_request',
      entityId: request.id,
      entityLabel: request.entityLabel,
      action: 'reject',
      summary: { policy: request.policy, entityType: request.entityType, entityId: request.entityId, operation: request.operation },
    });
    return this.findView(request.id);
  }

  async cancel(id: string): Promise<ChangeRequestView> {
    const { userId } = getTenantContext();
    const request = await this.loadPending(id);
    if (request.requestedByUserId !== userId) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'NOT_REQUESTER',
        message: 'Só quem fez o pedido pode cancelá-lo.',
      });
    }
    await this.decide(request.id, 'cancelled', 'Cancelado por quem pediu.', userId);
    return this.findView(request.id);
  }

  private async loadPending(id: string): Promise<ChangeRequest> {
    await this.expireOverdue();
    const request = await getTenantManager().findOne(ChangeRequest, { where: { id } });
    if (!request) throw new NotFoundException('Pedido não encontrado.');
    if (request.status !== 'pending') {
      throw new ConflictException({
        statusCode: 409,
        errorCode: 'REQUEST_NOT_PENDING',
        message: 'Este pedido já foi decidido ou expirou.',
        status: request.status,
      });
    }
    return request;
  }

  private async loadPendingForDecision(id: string): Promise<ChangeRequest> {
    const request = await this.loadPending(id);
    if (request.requestedByUserId === getTenantContext().userId) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'SELF_APPROVAL',
        message: 'Quem pediu a mudança não pode aprová-la nem recusá-la.',
      });
    }
    return request;
  }

  private async decide(id: string, status: ChangeRequestStatus, note: string | null, deciderId: string | null) {
    await getTenantManager().query(
      `UPDATE change_requests SET status = $2, "decisionNote" = $3, "decidedByUserId" = $4, "decidedAt" = now() WHERE id = $1`,
      [id, status, note, deciderId || null],
    );
  }

  private async findView(id: string): Promise<ChangeRequestView> {
    const rows: ChangeRequestView[] = await getTenantManager().query(`${VIEW_SELECT} WHERE cr.id = $1`, [id]);
    return rows[0];
  }

  private async currentSnapshot(request: ChangeRequest): Promise<Record<string, unknown> | null> {
    const manager = getTenantManager();
    if (request.entityType === 'product') {
      const product = await manager.findOne(Product, { where: { id: request.entityId! } });
      return product ? productSnapshot(product) : null;
    }
    if (request.entityType === 'loss') {
      const loss = await manager.findOne(Loss, { where: { id: request.entityId! } });
      return loss ? lossSnapshot(loss) : null;
    }
    return null;
  }

  /** Reaplica pelo MESMO método de serviço (mesmas validações), com a política dispensada. */
  private async apply(request: ChangeRequest): Promise<void> {
    const skip = { skipPolicy: true };
    switch (`${request.entityType}.${request.operation}`) {
      case 'product.update':
        await this.productsService.update(request.entityId!, request.payload as never, skip);
        return;
      case 'product.archive':
        await this.productsService.remove(request.entityId!, undefined, skip);
        return;
      case 'loss.update':
        await this.lossesService.update(request.entityId!, request.payload as never, skip);
        return;
      case 'loss.delete':
        await this.lossesService.remove(request.entityId!, undefined, skip);
        return;
      default:
        throw new BadRequestException('Tipo de pedido desconhecido.');
    }
  }
}
```

Create `backend/src/modules/approvals/approvals.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { ApprovalsService } from './approvals.service';
import { DecisionDto } from './dto/decision.dto';
import { ListChangeRequestsDto } from './dto/list-change-requests.dto';

/** Fila de pedidos de aprovação (SP2, 2.2) — só gerente. */
@Controller('change-requests')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // Rota estática antes das com parâmetro (mesma regra da 1.3).
  @Get('pending-count')
  pendingCount() {
    return this.approvalsService.pendingCount();
  }

  @Get()
  list(@Query() query: ListChangeRequestsDto) {
    return this.approvalsService.list(query.status ?? 'pending');
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.approvalsService.approve(id, body?.note);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.approvalsService.reject(id, body?.note);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.approvalsService.cancel(id);
  }
}
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npm run test:int -- src/modules/approvals/change-requests.http.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/approvals
git commit -m "feat(backend): fila de pedidos de aprovação (listar, aprovar, recusar, cancelar, expirar)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 11; todas as suítes verdes; `tsc exit=0`.

---

### Task 6: Configuração das políticas, módulo e registro

**Files:**
- Create: `backend/src/modules/approvals/dto/update-approval-policies.dto.ts`, `approval-policies.controller.ts`, `approvals.module.ts`, `approval-policies.http.int-spec.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md` (fim da seção 3), `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10)

**Interfaces:**
- Consumes: `loadCompanyPolicies`, `saveCompanyPolicies`, `countActiveManagers` (Task 3), `normalizePolicies`,
  `approvalModeFor` (Task 2).
- Produces: `GET /approval-policies` e `PUT /approval-policies` → `{ policies: ApprovalPolicies;
  activeManagers: number; mode: ApprovalMode }` (para a 2.2.2 — web); `ApprovalsModule` no `AppModule`.

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/modules/approvals/approval-policies.http.int-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { http, seedUser, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';
import { ApprovalPoliciesController } from './approval-policies.controller';

const ALL_ON = {
  price_change: { enabled: true, thresholdPercent: 30 },
  retro_fix: { enabled: true },
  loss_edit: { enabled: false },
  archive_with_history: { enabled: true },
};

describe('Configuração das políticas de aprovação (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp({ controllers: [ApprovalPoliciesController] }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Config');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  it('padrão: tudo desligado, limite 20, 1 gerente ⇒ modo justificativa', async () => {
    const { status, body } = await http(baseUrl, 'GET', '/api/approval-policies', token);
    expect(status).toBe(200);
    expect(body).toEqual({
      policies: {
        price_change: { enabled: false, thresholdPercent: 20 },
        retro_fix: { enabled: false },
        loss_edit: { enabled: false },
        archive_with_history: { enabled: false },
      },
      activeManagers: 1,
      mode: 'justification',
    });
  });

  it('PUT grava, devolve o modo atual e a mudança é auditada com o autor', async () => {
    await seedUser(companyId);
    const { status, body } = await http(baseUrl, 'PUT', '/api/approval-policies', token, ALL_ON);

    expect(status).toBe(200);
    expect(body).toEqual({ policies: ALL_ON, activeManagers: 2, mode: 'approval' });
    const [row] = await adminQuery(`SELECT "approvalPolicies" FROM companies WHERE id = $1`, [companyId]);
    expect(row.approvalPolicies).toEqual(ALL_ON);
    const [audit] = await adminQuery(
      `SELECT changes, "actorUserId" FROM audit_log WHERE "entityType" = 'company' AND action = 'update' ORDER BY seq DESC LIMIT 1`,
    );
    expect(audit.changes[0].field).toBe('approvalPolicies');
    expect(audit.actorUserId).not.toBeNull();
  });

  it.each([
    ['limite zero', { ...ALL_ON, price_change: { enabled: true, thresholdPercent: 0 } }],
    ['chave desconhecida', { ...ALL_ON, qualquer: { enabled: true } }],
    ['política faltando', { price_change: ALL_ON.price_change }],
    ['enabled não booleano', { ...ALL_ON, loss_edit: { enabled: 'sim' } }],
  ])('PUT com %s ⇒ 400', async (_label, payload) => {
    expect((await http(baseUrl, 'PUT', '/api/approval-policies', token, payload)).status).toBe(400);
  });

  it('funcionário não acessa (403)', async () => {
    const employeeToken = await tokenFor(await seedUser(companyId, 'employee'), companyId, 'employee' as never);
    expect((await http(baseUrl, 'GET', '/api/approval-policies', employeeToken)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/approvals/approval-policies.http.int-spec.ts`
Expected: FAIL na compilação — `Cannot find module './approval-policies.controller'`.

- [ ] **Step 3: Implementar**

Create `backend/src/modules/approvals/dto/update-approval-policies.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsNumber, Max, Min, ValidateNested } from 'class-validator';

class PolicyToggleDto {
  @IsBoolean()
  enabled: boolean;
}

class PriceChangePolicyDto extends PolicyToggleDto {
  @IsNumber()
  @Min(1)
  @Max(1000)
  thresholdPercent: number;
}

/** As 4 políticas, sempre completas (o painel envia o formulário inteiro). */
export class UpdateApprovalPoliciesDto {
  @IsDefined() @ValidateNested() @Type(() => PriceChangePolicyDto) price_change: PriceChangePolicyDto;
  @IsDefined() @ValidateNested() @Type(() => PolicyToggleDto) retro_fix: PolicyToggleDto;
  @IsDefined() @ValidateNested() @Type(() => PolicyToggleDto) loss_edit: PolicyToggleDto;
  @IsDefined() @ValidateNested() @Type(() => PolicyToggleDto) archive_with_history: PolicyToggleDto;
}
```

Create `backend/src/modules/approvals/approval-policies.controller.ts`:
```ts
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { countActiveManagers, loadCompanyPolicies, saveCompanyPolicies } from './approval-gate';
import { approvalModeFor, normalizePolicies } from './approval-policies';
import { UpdateApprovalPoliciesDto } from './dto/update-approval-policies.dto';

/**
 * Políticas de aprovação da própria empresa (SP2, 2.2). A mudança é auditada pelo trigger de companies. O
 * `mode` diz ao painel o que vai acontecer hoje ("1 gerente: as mudanças sensíveis pedirão justificativa").
 */
@Controller('approval-policies')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ApprovalPoliciesController {
  @Get()
  async get() {
    return this.describe();
  }

  @Put()
  async update(@Body() dto: UpdateApprovalPoliciesDto) {
    await saveCompanyPolicies(normalizePolicies(dto));
    return this.describe();
  }

  private async describe() {
    const activeManagers = await countActiveManagers();
    return { policies: await loadCompanyPolicies(), activeManagers, mode: approvalModeFor(activeManagers) };
  }
}
```

Create `backend/src/modules/approvals/approvals.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { LossesModule } from '../losses/losses.module';
import { ProductsModule } from '../products/products.module';
import { ApprovalPoliciesController } from './approval-policies.controller';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ChangeRequest } from './change-request.entity';

@Module({
  // Company: exigida pelo SubscriptionGuard. Produtos e Perdas: a aprovação reaplica pelos mesmos serviços.
  imports: [TypeOrmModule.forFeature([ChangeRequest, Company]), ProductsModule, LossesModule],
  controllers: [ApprovalsController, ApprovalPoliciesController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
```

Modify `backend/src/app.module.ts`: importar `ApprovalsModule` de `./modules/approvals/approvals.module` e
acrescentá-lo ao `imports` depois de `AuditModule`.

- [ ] **Step 4: Rodar, checar**

```bash
npm run test:int -- src/modules/approvals/approval-policies.http.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```
Expected: PASS 7; todas as suítes verdes; `tsc exit=0`.

- [ ] **Step 5: Registrar e commit**

No spec do SP2, ao fim da seção 3.6 (antes de `**Pronto quando:**` da seção 3):
```markdown
**Divisão da etapa (2026-09-25):** 2.2.1 = backend; 2.2.2 = web (Configurações › Aprovações, página
Aprovações com selo no menu, diálogos de justificativa e "Enviado para aprovação").
**Resultado da 2.2.1 (<data>):** migration `1700000017000-ApprovalRequests` (`companies.approvalPolicies`,
`change_requests` com RLS, sem DELETE para o app, um pendente por entidade+política); regras puras
(`approval-policies.ts`, limite em centavos inteiros); portão `approval-gate.ts` em `PATCH/DELETE
/products/:id` e `PATCH/DELETE /losses/:id` (409 `JUSTIFICATION_REQUIRED` com `mode`, 202 pendente);
`GET /change-requests`, `/pending-count`, `POST /:id/approve|reject|cancel`; `GET/PUT /approval-policies`.
**Decisões da execução:** colunas `operation` e `entityLabel` em `change_requests`; o 409 informa também o
`mode`; aprovação sobre registro alterado devolve 200 com o pedido `expired` (lançar erro desfaria a marcação);
reaplicação que falha devolve o erro e mantém o pedido pendente; cancelar é só de quem pediu; políticas em
`/approval-policies` (fora de `companies/me/settings`); histórico de preço aprovado sai com origem `approval`.
```
Na seção 10 do mestre, linha do SP2: "2.2.1 (backend de aprovações) executada em <data>", link do plano,
baselines.

```bash
cd /c/PROJETOS/SAAS
git add backend/src/modules/approvals backend/src/app.module.ts docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "feat(backend): configuração das políticas de aprovação e módulo de aprovações" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Banco de desenvolvimento:** a migration 17000 só entra em `inventory_saas` com autorização do usuário
(perguntar ao fim). Sem ela o backend novo quebra as telas de produtos/perdas (a checagem lê
`companies.approvalPolicies`).

---

## Auto-revisão

**Cobertura do spec (seção 3, backend):** 3.1 políticas e padrões → Tasks 1, 2 e 6; `price_change` com
limite/valor anterior 0 → Task 2 (+ HTTP na 3); `loss_edit` → Task 4; `archive_with_history` → Task 3;
`retro_fix` só configurável (uso na 2.3); 3.2 modo automático e gerente inativo → Tasks 2 e 3; 3.3 contrato
409/202 e `justification` nos 4 endpoints → Tasks 3 e 4; 3.4 tabela, índice, RLS, autoaprovação, cancelar,
reaplicar pelo mesmo método, conflito por snapshot, expiração preguiçosa, um pendente por entidade+política,
auditoria `request`/`approve`/`reject`/`justify` e `reason` na linha do trigger → Tasks 1, 3 e 5; 3.6 testes
unitários (limite, zero, bordas, modo 0/1/2+) → Task 2; integração (409, 202, aprovar, autoaprovação, recusa,
cancelamento, expiração, conflito, auditoria, RLS) → Tasks 1, 3, 4 e 5. Telas (3.5) e testes web → 2.2.2.

**Placeholders:** `<data>` na Task 6 é preenchido na execução. A nota de fallback do `seedLoss` (Task 3)
indica exatamente o que copiar se o INSERT exigir as colunas de valor.

**Consistência:** `applyApprovalGate` (Task 3) é usado com `operation` `update`/`archive` (produtos) e
`update`/`delete` (perdas), os mesmos casos do `switch` de `ApprovalsService.apply` (Task 5).
`productSnapshot`/`lossSnapshot` são usados no pedido (Tasks 3–4) e na aprovação (Task 5) — mesma função,
mesma representação. `isPendingApproval` exige `status: 'pending'` **e** `changeRequestId` — um `Product` ou
`Loss` nunca tem `changeRequestId`. `startApprovalsApp({ controllers, providers })` (Task 3) é usado nas Tasks
5 e 6.

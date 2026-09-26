# SP3 etapa 3.1.2 — Motor de importação: confirmação, aprovações e gravação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a importação simulada na 3.1.1 pode ser confirmada (`POST /imports/:id/apply`), passa pelas políticas de aprovação do SP2 como um único pedido e é gravada em lotes de 500 com o "antes" guardado; o endpoint antigo `POST /products/import` passa a usar o motor novo.

**Architecture:** um worker `ImportApplier` (mesmo molde do `ImportSimulator`: transação curta por lote, `runId` + `attemptId` com `SELECT … FOR UPDATE`) lê `import_rows`, recalcula a ação contra o catálogo atual pelo handler e grava com `INSERT` (criações) e `UPDATE … FROM unnest` (atualizações/reativações). A confirmação roda no HTTP com trava por empresa (`pg_advisory_xact_lock`) e o portão de aprovação do SP2; a aprovação de um pedido `import_job` só muda o status e enfileira.

**Tech Stack:** NestJS 10, TypeORM 0.3 (SQL cru), Postgres 16 com RLS, BullMQ, Jest.

**Spec:** `docs/superpowers/specs/2026-09-26-sp3-importacao-exportacao-design.md` (seções 1.5, 2.4, 2.5, 3; seção 7 linha 3.1.2)

## Global Constraints

- Mensagens em português; `errorCode`: `INVALID_STATE`, `IMPORT_IN_PROGRESS`, `ARCHIVE_CONFIRMATION_REQUIRED`, `JUSTIFICATION_REQUIRED`.
- Lotes de **500** linhas, cada um numa transação própria; `updatedAt = clock_timestamp()`.
- Contexto de cada transação do worker: `app.current_company_id`, `app.current_user_id` = `createdByUserId` do job, `app.change_source = 'import'`, `app.audit_mode = 'summary'`, `app.audit_source = 'import'`.
- Confirmação forte: `archiveMissing` com ausentes > **20%** dos produtos ativos exige `confirmArchiveCount === missingCount`.
- Célula não informada (`null`) nunca apaga valor existente (ruling da 3.1.1); produto novo com preço não informado grava 0.
- Enfileirar sempre via `afterCommit`.
- Nunca `git add -A` na raiz (`.superpowers/` não está no .gitignore).

## Review Focus

1. **Catálogo muda entre a simulação e a gravação** (preço editado no painel, produto arquivado ou criado por outra pessoa): a gravação recalcula contra o estado atual e nunca falha a importação inteira — Task 1 (teste "catálogo mudou").
2. **Falha no meio da gravação** (erro no lote 2): lotes anteriores ficam gravados, `retry` continua sem regravar — Task 1 e Task 2 (teste "retry continua").
3. **Duas confirmações ao mesmo tempo** (duplo clique, duas abas): uma só grava — Task 2 (teste de 409 concorrente).
4. **Pedido de aprovação vence sem ninguém decidir**: o job não pode ficar `pending_approval` para sempre — Task 3 (teste de vencimento).
5. **Tela antiga de produtos** continua funcionando (upload → polling de `GET /products/import/:id` até `completed`/`failed`) — Task 4 (teste do endpoint antigo).

---

## File Structure

```
backend/src/modules/imports/
  engine/types.ts                         (mod) ApplyRow/AppliedRow + applyBatch/archiveMissingBatch no handler
  handlers/products.import-handler.ts     (mod) applyBatch, archiveMissingBatch
  import-applier.ts                       (novo) worker da gravação
  import-jobs.service.ts                  (mod) apply, retry, cancel, startApprovedApply, list, template, purge, reconcile
  import-jobs.controller.ts               (mod) rotas novas
  dto/apply-import.dto.ts                 (novo)
  imports-queue.processor.ts              (mod) 'apply' + autoApply após 'simulate'
  imports.controller.ts                   (mod) endpoint antigo pelo motor
  imports.service.ts, imports.processor.ts (remover) fluxo antigo
  imports.module.ts                       (mod) exporta ImportJobsService; remove fila antiga
backend/src/modules/approvals/
  approval-gate.ts                        (mod) operation 'import'
  approvals.service.ts, approvals.module.ts (mod) caso import_job
backend/src/test-utils/imports-test-app.ts (mod) aceita controllers/providers extras
```

---

### Task 1: Gravação em lotes (handler + worker)

**Files:**
- Create: `backend/src/modules/imports/import-applier.ts`
- Modify: `backend/src/modules/imports/engine/types.ts`, `backend/src/modules/imports/handlers/products.import-handler.ts`, `backend/src/modules/imports/import-job.entity.ts` (`ImportOptions.applyRunId`, `applyStartedAt`, `actorUserId`)
- Test: `backend/src/modules/imports/import-apply.int-spec.ts`

**Interfaces:**
- Produces (`engine/types.ts`):
  - `interface ApplyRow { rowId: string; key: string; values: Record<string, unknown> }`
  - `interface AppliedRow { rowId: string; entityId: string | null; appliedAction: RowAction; before: Record<string, unknown> | null; updatedAt: Date | null; error?: string }`
  - handler: `applyBatch(manager: EntityManager, rows: ApplyRow[], ctx: { mappedFields: string[]; updateFields: string[] }): Promise<AppliedRow[]>`; `archiveMissingBatch(manager: EntityManager, jobId: string, limit: number): Promise<{ entityId: string; key: string; before: Record<string, unknown>; updatedAt: Date }[]>`
- Produces: `class ImportApplier { constructor(dataSource: DataSource); run(data: ImportQueueData & { applyRunId: string }): Promise<void> }` (usa `ImportQueueData.runId` como o `applyRunId`; a mensagem da fila é `{ jobId, companyId, runId }` com o `options.applyRunId`).
- `ImportOptions` ganha `applyRunId?: string`, `applyStartedAt?: string`, `actorUserId?: string` (quem aprovou, quando houver; o autor das mudanças continua sendo `createdByUserId`).

- [ ] **Step 1: Testes que falham** (`import-apply.int-spec.ts`; usa `startImportsApp`, simula via HTTP + `ImportSimulator.run`, prepara o job com `UPDATE import_jobs SET status='applying', options = options || '{"applyRunId":"r1"}'` e chama `new ImportApplier(ds).run({ jobId, companyId, runId: 'r1' })`):
  - ponta a ponta com a planilha da 3.1.1 (create/update/reactivate/unchanged/erro/duplicada): `status 'completed'`, `appliedAt`, `completedAt`; produto novo criado com preço 3 e `isActive`; `100` com preço 12; `200` reativado; `300` intacto (mesmo `updatedAt`); linhas com erro/duplicadas sem `appliedAt`; linhas aplicadas com `productId`, `appliedAction`, `appliedUpdatedAt` igual ao `updatedAt` atual do produto e `before` com o estado anterior (`unitPrice: 10` para `100`); `summary.appliedCount === 4`; `successCount === 4`.
  - histórico de preço do `100` com `source = 'import'` e `changedByUserId` = autor do job.
  - auditoria: nenhuma linha `update` por produto (modo resumo) e um evento `action = 'import'` com `summary` `{ status: 'completed', created: 1, updated: 1, reactivated: 1, unchanged: 1, archived: 0, errors: 3 }` e `actorUserId` = autor.
  - campos fora de `updateFields` intactos (simula com `updateFields: ['unitPrice']`, nome diferente na planilha ⇒ nome do produto não muda); preço não informado na planilha não zera o preço do existente.
  - **catálogo mudou**: depois da simulação, `UPDATE products SET "unitPrice" = 12 WHERE barcode='100'` e arquiva `300` ⇒ gravação: `100` vira `unchanged` (sem escrita), `300` vira `reactivate`; e um produto `1234567` criado por fora entre simulação e gravação ⇒ a linha `create` vira `update`/`unchanged` (nunca erro de chave duplicada).
  - `archiveMissing: true` nas options ⇒ `400` arquivado, linha `archive` com `before.isActive = true`; `summary.counts.archive`/evento com `archived: 1`.
  - `archiveMissing` com `confirmArchiveCount: 1` e dois ausentes no momento da gravação ⇒ `status 'failed'`, `lastError 'O número de produtos ausentes mudou (era 1, agora 2). Simule de novo.'`, nenhum produto alterado.
  - **falha no meio**: `ImportApplier` com `limits: { batchSize: 2 }` e um lote que falha (trigger temporário `RAISE EXCEPTION` criado pelo teste em `products` para `barcode = '300'`… usar produto do 2º lote) ⇒ `failed` com `lastError`, lote 1 gravado e com `appliedAt`; removido o trigger, `run` de novo com outro `applyRunId` ⇒ `completed`, sem regravar o lote 1 (`appliedAt` do lote 1 não muda).
  - mensagem velha: `run` com `runId` diferente de `options.applyRunId` ⇒ nada muda.
  - reentrega simultânea (mesmo portão do teste da 3.1.1, travando em `handler.applyBatch` via `limits.beforeBatch` hook) ⇒ cada linha aplicada uma vez.
- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- import-apply`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar**:
  - `applyBatch` (produtos): `SELECT … WHERE barcode = ANY($1) FOR UPDATE`; para cada linha `plan(values, existing, { mappedFields, updateFields, priceThresholdPercent: null })`; `unchanged` ⇒ sem escrita; `create` ⇒ `INSERT INTO products ("companyId", barcode, name, sku, "unitPrice", "costPrice", "updatedAt") SELECT current_setting('app.current_company_id')::uuid, … FROM unnest(...) ON CONFLICT ("companyId", barcode) DO NOTHING RETURNING id, barcode, "updatedAt"` (preço/custo `COALESCE(x, 0)`; SKU só se mapeado); linhas cujo `INSERT` não voltou (criadas por fora no meio) são reprocessadas como existentes no mesmo lote (novo `SELECT … FOR UPDATE` + `plan`); `update`/`reactivate` ⇒ `UPDATE products p SET <para cada campo em updateFields ∩ mapeados: "campo" = COALESCE(v."campo", p."campo")>, "isActive" = true, "updatedAt" = clock_timestamp() FROM unnest(...) AS v(...) WHERE p.id = v.id RETURNING p.id, p."updatedAt"` (lista de colunas vinda de uma whitelist fixa: `name, sku, unitPrice, costPrice`); `before` = `{ name, sku, unitPrice, costPrice, isActive, updatedAt }` do `SELECT`.
  - `archiveMissingBatch`: `SELECT p.id, p.barcode, p.name, p.sku, p."unitPrice", p."costPrice", p."updatedAt" <MISSING_FROM> LIMIT $2 FOR UPDATE OF p` + `UPDATE products SET "isActive" = false, "updatedAt" = clock_timestamp() WHERE id = ANY($1) RETURNING id, "updatedAt"`.
  - `ImportApplier.run`: tx inicial (lock com `status 'applying'` + `options.applyRunId`; grava `attemptId`; confere ausentes × `confirmArchiveCount`); laço de lotes `SELECT id, key, normalized FROM import_rows WHERE "jobId" = $1 AND action IN ('create','update','reactivate','unchanged') AND "appliedAt" IS NULL ORDER BY "rowNumber" LIMIT $2 FOR UPDATE` ⇒ `applyBatch` ⇒ `UPDATE import_rows … FROM unnest` (`productId`, `appliedAction`, `before`, `appliedUpdatedAt`, `appliedAt = now()`) ⇒ `summary.appliedCount`; laço de ausentes (inserindo linhas `archive` já com `appliedAt`); tx final (`completed`, contagens por `appliedAction`, `successCount`, evento de auditoria). Falha ⇒ `failed` + `lastError` (mensagem do erro). `limits?: { batchSize?: number; beforeBatch?: () => Promise<void> }` só para testes.
- [ ] **Step 4: Rodar** — `npm run test:int -- import-apply`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): gravação da importação em lotes com o "antes" guardado`

### Task 2: Confirmar, tentar de novo e cancelar (HTTP) + trava por empresa

**Files:**
- Create: `backend/src/modules/imports/dto/apply-import.dto.ts`
- Modify: `backend/src/modules/imports/import-jobs.service.ts`, `backend/src/modules/imports/import-jobs.controller.ts`, `backend/src/modules/imports/imports-queue.processor.ts`, `backend/src/modules/approvals/approval-gate.ts` (`operation` aceita `'import'`)
- Test: `backend/src/modules/imports/import-confirm.http.int-spec.ts`

**Interfaces:**
- `ApplyImportDto { archiveMissing?: boolean; confirmArchiveCount?: number; justification?: string (1..1000) }`
- `ImportJobsService.apply(id, dto): Promise<{ job: ImportJob } | { status: 'pending'; changeRequestId: string; job: ImportJob }>`; `.retry(id): Promise<ImportJob>`; `.cancel(id): Promise<ImportJob>`; `.startApply(job: ImportJob, actorUserId: string | null): Promise<void>` (status `applying`, `applyRunId`, `applyStartedAt`, `afterCommit` enfileira `'apply'`) — usado também pela aprovação (Task 3).
- Processor: `'apply'` ⇒ `ImportApplier.run`.

- [ ] **Step 1: Testes que falham**:
  - `apply` em job `simulated` ⇒ 202 `{ job: { status: 'applying' } }` e 1 mensagem `'apply'` na fila depois da resposta com `runId === job.options.applyRunId`; rodando o `ImportApplier` com ela ⇒ `completed`.
  - `apply` em `uploaded`/`simulating`/`completed` ⇒ 409 `INVALID_STATE`.
  - outro job da empresa em `applying`/`simulating`/`pending_approval` ⇒ 409 `IMPORT_IN_PROGRESS` `'Já existe uma importação em andamento. Aguarde terminar ou cancele-a.'`; job de **outra empresa** em andamento não bloqueia.
  - duas chamadas `apply` simultâneas no mesmo job ⇒ uma 202 e uma 409 (`Promise.all`).
  - `archiveMissing` com ausentes > 20% dos ativos e sem `confirmArchiveCount` ⇒ 409 `ARCHIVE_CONFIRMATION_REQUIRED` com `missingCount` no corpo; com o número certo ⇒ 202; ≤ 20% ⇒ não exige.
  - política `price_change` (limite 10) com 1 gerente: sem justificativa ⇒ 409 `JUSTIFICATION_REQUIRED` (`mode: 'justification'`); com justificativa ⇒ 202 e evento `justify` com `entityType 'import_job'`.
  - mesma política com 2 gerentes ⇒ 202 `{ status: 'pending', changeRequestId }`, job `pending_approval` com `changeRequestId`, pedido com `policy 'price_change'`, `entityType 'import_job'`, `operation 'import'`, `snapshot { jobId, simulatedAt, status: 'pending_approval' }`; nada enfileirado.
  - `archive_with_history` ligada, `archiveMissing` e ausente com perda ⇒ pedido com `policy 'archive_with_history'` (sem mudança de preço sensível).
  - `retry` só em `failed` com `options.applyStartedAt` ⇒ `applying` + nova mensagem com outro `applyRunId`; em falha de simulação (sem `applyStartedAt`) ⇒ 409.
  - `cancel` em `uploaded`/`simulated` ⇒ `cancelled`; em `pending_approval` ⇒ `cancelled` e o pedido vira `cancelled`; em `applying`/`completed` ⇒ 409.
  - `simulate`/`preview` recusam job com `options.applyStartedAt` (409).
- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- import-confirm`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `apply` (ordem: `findOne` → estado → `pg_advisory_xact_lock(hashtext('imports:' || companyId))` → outro job ativo? → releitura do job com `FOR UPDATE` → confirmação forte (ausentes recontados agora; ativos = `count(*) FROM products WHERE "isActive"`) → grava `archiveMissing`/`confirmArchiveCount` em `options` → políticas (`loadCompanyPolicies`; sensível conforme a spec 2.4) ⇒ `applyApprovalGate` ⇒ pendente: `pending_approval`; senão `startApply`), `retry`, `cancel` (pedido pendente ⇒ `UPDATE change_requests SET status='cancelled', "decidedAt"=now(), "decisionNote"='Importação cancelada.'`), `assertEditable` também recusa `options.applyStartedAt`.
- [ ] **Step 4: Rodar** — `npm run test:int -- import-confirm import-simulation import-upload`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): confirmação com aprovações, tentar de novo e cancelar`

### Task 3: Aprovação de pedido de importação

**Files:**
- Modify: `backend/src/modules/approvals/approvals.service.ts`, `backend/src/modules/approvals/approvals.module.ts`, `backend/src/modules/imports/imports.module.ts` (exporta `ImportJobsService`), `backend/src/modules/imports/import-jobs.service.ts` (reconciliação), `backend/src/test-utils/imports-test-app.ts` (parâmetro `extra`)
- Test: `backend/src/modules/imports/import-approval.http.int-spec.ts`

**Interfaces:**
- Consumes: `ImportJobsService.startApply` (Task 2).
- `ImportJobsService.approvalSnapshot(jobId): Promise<Record<string, unknown> | null>` (trava o job; `{ jobId, simulatedAt, status }` ou `null`); `.onRequestClosed(jobId): Promise<void>` (job `pending_approval` ⇒ `cancelled` com `lastError 'Pedido de aprovação recusado, cancelado ou vencido.'`).
- `startImportsApp(extra?: { controllers?: any[]; providers?: any[] })`.

- [ ] **Step 1: Testes que falham** (app com controllers de importação + `ApprovalsController` + `ApprovalsService`, `ProductsService`, `LossesService`; 2 gerentes):
  - gerente B aprova ⇒ pedido `approved`, job `applying`, 1 mensagem `'apply'` enfileirada após a resposta; `ImportApplier.run` ⇒ `completed`; evento `approve` do pedido existe.
  - quem pediu não aprova ⇒ 403 `SELF_APPROVAL` (regra do SP2 vale).
  - job alterado depois do pedido (re-simulado ⇒ `simulatedAt` diferente) ⇒ aprovar expira o pedido e não enfileira.
  - recusar ⇒ pedido `rejected`, job `cancelled`.
  - cancelar o pedido pela fila ⇒ job `cancelled`.
  - pedido vencido (`UPDATE change_requests SET "expiresAt" = now() - interval '1 day'`) ⇒ `GET /imports/:id` devolve `cancelled` e o pedido fica `expired`.
- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- import-approval`. Esperado: FAIL.
- [ ] **Step 3: Implementar** — `currentSnapshot`: `request.entityType === 'import_job'` ⇒ `importJobs.approvalSnapshot`; `apply`: caso `import_job.import` ⇒ `importJobs.startApply(job, userId)`; `reject`/`cancel` ⇒ `importJobs.onRequestClosed` quando `entityType === 'import_job'`; `findOne`/`list` de importações reconciliam: pedido `pending` com `expiresAt < now()` ⇒ marca `expired` (mesma nota do SP2) e `onRequestClosed`; pedido não pendente ⇒ `onRequestClosed`.
- [ ] **Step 4: Rodar** — `npm run test:int -- import-approval approvals change-requests`. Esperado: PASS (as suítes do SP2 continuam verdes).
- [ ] **Step 5: Commit** — `feat(imports): pedido de aprovação de importação aprovado, recusado ou vencido`

### Task 4: Endpoint antigo pelo motor, histórico, modelo e limpeza

**Files:**
- Modify: `backend/src/modules/imports/imports.controller.ts`, `backend/src/modules/imports/imports.module.ts`, `backend/src/modules/imports/import-jobs.service.ts`, `backend/src/modules/imports/import-jobs.controller.ts`, `backend/src/modules/imports/imports-queue.processor.ts`
- Delete: `backend/src/modules/imports/imports.service.ts`, `backend/src/modules/imports/imports.processor.ts`, `backend/src/modules/imports/imports.processor.int-spec.ts` (coberto pelos testes novos)
- Test: `backend/src/modules/imports/import-legacy-and-history.http.int-spec.ts`

**Interfaces:**
- `ImportJobsService.list({ resource, page, limit }): Promise<{ items: (ImportJob & { createdByName: string | null })[]; total: number }>`; `.template(resource): Promise<Buffer>`; `.purgeExpired(): Promise<void>` (empresa atual: apaga `import_rows` de jobs com `createdAt < now() - 30 days` e marca `summary.rowsPurged`; `uploaded`/`simulated` com `createdAt < now() - 7 days` ⇒ `cancelled`), chamado no `upload` e no `list`.
- Endpoint antigo: `POST /products/import` (multipart `file` + `mapping` JSON antigo) ⇒ `{ jobId }`; `GET /products/import/:id` ⇒ `{ id, status, fileName, totalRows, successCount, errorCount, errorReport, createdAt, completedAt }` com `status` mapeado (`uploaded|simulating|applying` ⇒ `processing`; `simulated|pending_approval|cancelled|failed` ⇒ `failed` com `errorReport` = `[{ row: 0, error: lastError ?? 'Importação não concluída.' }]` quando não houver outro; `completed` ⇒ `completed`).
- Processor: depois de `'simulate'`, se o job está `simulated` com `options.autoApply` ⇒ `ImportApplier` direto se nenhuma política se aplica (mesma regra da Task 2), senão `lastError = 'Esta importação precisa de justificativa/aprovação. Use a nova tela de importação.'`.

- [ ] **Step 1: Testes que falham**:
  - antigo: planilha `Codigo;Nome;Preco` + mapping `{ barcodeColumn, nameColumn, unitPriceColumn }` ⇒ `{ jobId }`; simulador + (autoApply) ⇒ `GET /products/import/:id` ⇒ `completed`, `successCount` correto; preço mudou com `source 'import'`; produto arquivado na planilha é reativado.
  - antigo com coluna inexistente no mapping ⇒ 400 (antes era falha tardia).
  - antigo com `price_change` ligada e mudança sensível ⇒ `failed` com a mensagem de "precisa de justificativa/aprovação" e nada gravado.
  - `GET /imports?resource=products&page=1&limit=10` ⇒ jobs da empresa, mais novo primeiro, com `createdByName`; não lista de outra empresa.
  - `GET /imports/template?resource=products` ⇒ `.xlsx` cujos cabeçalhos são `Código de barras, Nome, SKU, Preço de venda, Custo`, coluna A com `numFmt '@'`, e que, reenviado ao `POST /imports`, tem `suggestedMapping` com os 5 campos.
  - limpeza: job de 31 dias com linhas ⇒ após `GET /imports`, `import_rows` do job vazio e `summary.rowsPurged`; job `simulated` de 8 dias ⇒ `cancelled`.
- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- import-legacy-and-history`. Esperado: FAIL.
- [ ] **Step 3: Implementar** (a rota `GET /imports/template` antes de `GET /imports/:id` no controller; `@Header` do content-type xlsx; a fila `products-import` sai do `BullModule.registerQueue`).
- [ ] **Step 4: Rodar** — `npm run test:int -- import-legacy-and-history import-confirm import-apply`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): endpoint antigo pelo motor novo, histórico, modelo e limpeza`

### Task 5: Carga, verificação real e documentação

**Files:**
- Test: `backend/src/modules/imports/import-load.int-spec.ts` (timeout alto)
- Modify: spec seção 9, mestre seção 10

- [ ] **Step 1: Teste de carga** — 50 mil linhas (xlsx gerado com exceljs, 10 mil produtos existentes, 40 mil novos): simulação + gravação ⇒ `completed`, 50 000 produtos no total, tempos medidos e impressos (`console.log`); expectativa: cada fase < 3 min. Anotar os tempos na seção 9 da spec.
- [ ] **Step 2: Suítes** — `npm test`, `npm run test:int`, `npx tsc --noEmit -p tsconfig.json`, `npm run build`. Esperado: verde.
- [ ] **Step 3: Verificação real** — backend local: upload → simulate → apply de uma planilha real gerada; conferir produto no banco, histórico de preço e evento de auditoria; tela antiga de produtos do painel importa uma planilha e termina em `completed`.
- [ ] **Step 4: Documentar** e commit — `docs: SP3 etapa 3.1.2 concluída`.

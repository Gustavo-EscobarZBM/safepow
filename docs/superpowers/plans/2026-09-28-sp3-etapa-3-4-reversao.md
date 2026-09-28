# SP3 etapa 3.4 — Reversão de importação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o gerente desfaz uma importação concluída há até 30 dias: vê a prévia (quantas alterações voltam e quais produtos mudaram depois e ficam como estão), confirma (com justificativa/aprovação do SP2 quando a política pede) e o worker restaura o catálogo em lotes.

**Architecture:** o motor ganha três métodos no `ImportResourceHandler` (prévia com conflitos, contagem sensível e lote de reversão), implementados no handler de produtos a partir de `import_rows.before`/`appliedUpdatedAt`. `ImportJobsService` ganha `rollbackPreview`, `rollback` (portão de aprovação com `operation 'rollback'`) e `startApprovedRollback`; o worker `ImportRollbacker` (fila `imports`, mensagem `rollback`) segue o padrão do `ImportApplier` (lotes de 500, `rollbackRunId` + `attemptId`, trava do job, retomável). No painel, o `ResultStep` ganha "Reverter importação" com um diálogo de prévia, e os estados `rolling_back`/`rolled_back`.

**Tech Stack:** NestJS + TypeORM (SQL cru) + Postgres/RLS + BullMQ; Next.js + vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-sp3-importacao-exportacao-design.md` (2.6; 1.2; 1.5; 3; 6 item 5; I7)

## Global Constraints

- Só `completed` com `appliedAt` há ≤ **30 dias** e sem `summary.rowsPurged`; fora disso 409 `ROLLBACK_EXPIRED` ("Esta importação tem mais de 30 dias e não pode mais ser revertida.").
- Trava de empresa (`pg_advisory_xact_lock(hashtext('imports:'||companyId))`) e 409 `IMPORT_IN_PROGRESS` como no `apply`.
- Conflito = produto atual com `updatedAt <> appliedUpdatedAt` (ou produto que não existe mais); conflitos ficam como estão.
- Ações: `create` ⇒ arquiva; `update` ⇒ restaura `name, sku, unitPrice, costPrice` do `before`; `reactivate` ⇒ restaura os mesmos campos **e** arquiva (desvio: a spec diz só "arquiva"; restaurar os campos é o que desfaz de verdade); `archive` ⇒ reativa. `updatedAt = clock_timestamp()`.
- Worker: lotes de **500**, contexto `app.change_source = 'import_rollback'`, `app.audit_mode = 'summary'`, `app.audit_source = 'import'`, ator = quem liberou (autor ou aprovador); trava `FOR UPDATE` e reconfere o conflito no momento.
- Final: `rolled_back`, `rolledBackAt`, `summary.rolledBackCount`/`conflictCount`, evento de auditoria `action 'rollback'`. Falha no meio ⇒ volta a `completed` com `lastError` (retomável: continua das linhas sem `rolledBackAt`); `rolling_back` parado há > 5 min aceita nova reversão.
- Políticas (SP2, `operation 'rollback'`): preço voltando além do limite (contra o preço ATUAL) ⇒ `price_change`; arquivar produtos com perdas ⇒ `archive_with_history`. Pedido pendente: o job fica `completed` com `options.rollbackRequestId`.
- Migrations novas só no banco de dev com backup `pg_dump` antes. Backend: `npm test`, `npm run test:int` (nunca em paralelo), tsc. Web: `npm test`, tsc. Depois de mudar o backend, remontar o container (`docker compose up -d --build backend`). Nunca `git add -A` na raiz.

## Review Focus

1. **Produto mexido depois da importação** (editado à mão, outra importação, perda registrada que mudou `updatedAt`): vira conflito e não é sobrescrito — Task 2 (teste de conflito) e Task 3 (reconferência no worker).
2. **Reversão interrompida** (worker cai no meio): o job volta a `completed` com a mensagem e "Reverter" continua sem desfazer duas vezes — Task 3.
3. **Duas reversões / reversão com outra importação em andamento**: 409, nada gravado — Task 3.
4. **Aprovação**: aprovar dispara a reversão; recusar/vencer deixa a importação `completed` e reversível — Task 3.
5. **Prévia com muitos conflitos**: paginada; o diálogo não trava nem mostra lista de outra página (resposta atrasada) — Task 4.

---

### Task 1: Migration e contrato do motor

**Files:** Create `backend/src/database/migrations/1700000019000-ImportRollback.ts` (+ `imports-rollback-schema.int-spec.ts`); Modify `backend/src/modules/imports/import-row.entity.ts`, `engine/types.ts`, `import-job.entity.ts`.

**Interfaces (Produces):**
- Migration: `import_rows."rollbackResult" varchar(12) NULL CHECK IN ('restored','conflict')`; CHECK de `audit_log.action` ganha `'rollback'` (recria a constraint pelo nome encontrado no catálogo, como a 18000 faz com o histórico de preço). `down` reverte.
- `ImportRow.rollbackResult: 'restored' | 'conflict' | null`.
- `ImportOptions` ganha `rollbackRunId?`, `rollbackStartedAt?`, `rollbackRequestedAt?`, `rollbackRequestId?`, `rollbackActorUserId?`.
- `engine/types.ts`:
  ```ts
  interface RollbackConflict { key: string; name: string | null; appliedAction: RowAction; reason: 'changed' | 'deleted' }
  interface RollbackPreview { restore: number; conflicts: number; items: RollbackConflict[]; total: number }
  // no ImportResourceHandler:
  rollbackPreview(manager, jobId, page: number, limit: number): Promise<RollbackPreview>;
  countRollbackSensitive(manager, jobId, thresholdPercent: number | null): Promise<{ priceChange: number; archiveWithHistory: number }>;
  rollbackBatch(manager, jobId, limit: number): Promise<{ restored: number; conflicts: number }>; // 0+0 ⇒ acabou
  ```

- [ ] **Step 1:** Teste que falha (`imports-rollback-schema.int-spec.ts`): coluna existe e recusa `'x'`; `audit_log` aceita `action 'rollback'`.
- [ ] **Step 2:** `npm run test:int -- imports-rollback-schema` ⇒ FAIL. **Step 3:** Implementar (migration + tipos; handler de produtos com os três métodos lançando `Error('não implementado')` só se o tsc exigir — preferir implementar na Task 2). **Step 4:** ⇒ PASS; tsc.
- [ ] **Step 5:** Backup `pg_dump` do `inventory_saas` em `C:\PROJETOS\SAAS-backups\` e `npm run migration:run` no dev.
- [ ] **Step 6:** Commit — `feat(imports): migration da reversão (rollbackResult, auditoria rollback)`

### Task 2: Prévia da reversão

**Files:** Modify `handlers/products.import-handler.ts`, `import-jobs.service.ts`, `import-jobs.controller.ts`, `dto/list-import-rows.dto.ts` (reusa `PageQueryDto`); Create `import-rollback.http.int-spec.ts`.

**Interfaces:**
- `GET /imports/:id/rollback-preview?page=&limit=` ⇒ `{ restore, conflicts, items, total, expiresAt: string }` (`expiresAt` = `appliedAt + 30 dias`).
- `ImportJobsService.rollbackPreview(id, query): Promise<RollbackPreview & { expiresAt: string }>` — `assertRollbackable(job)` (409 `INVALID_STATE` se não `completed`; 409 `ROLLBACK_EXPIRED` se > 30 dias ou `rowsPurged`).
- `ROLLBACK_WINDOW_DAYS = 30`.

- [ ] **Step 1: Testes que falham** (`import-rollback.http.int-spec.ts`, fluxo real: upload → simulate (ImportSimulator) → apply (ImportApplier) como em `import-confirm.http.int-spec.ts`): prévia de uma importação com 1 criado, 1 atualizado, 1 reativado e 1 arquivado (ausente) ⇒ `restore 4, conflicts 0`; editar o preço do atualizado depois (UPDATE com `updatedAt = clock_timestamp()`) ⇒ `restore 3, conflicts 1` e o item `{ key, name, appliedAction: 'update', reason: 'changed' }`; job `simulated` ⇒ 409 `INVALID_STATE`; `appliedAt` de 31 dias ⇒ 409 `ROLLBACK_EXPIRED`; `rowsPurged` ⇒ `ROLLBACK_EXPIRED`; paginação (`limit=1` com 2 conflitos ⇒ 1 item, `total 2`); funcionário ⇒ 403.
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** Implementar. **Step 4:** `npm run test:int -- import-rollback` ⇒ PASS; tsc.
- [ ] **Step 5:** Commit — `feat(imports): prévia da reversão com conflitos`

### Task 3: Reverter (portão, worker, aprovações)

**Files:** Create `backend/src/modules/imports/import-rollbacker.ts`, `dto/rollback-import.dto.ts`; Modify `handlers/products.import-handler.ts` (`rollbackBatch`, `countRollbackSensitive`), `import-jobs.service.ts`, `import-jobs.controller.ts`, `imports-queue.processor.ts`, `approvals/approvals.service.ts`; Test `import-rollback.http.int-spec.ts` (mais casos), `import-approval.http.int-spec.ts` (caso rollback).

**Interfaces:**
- `RollbackImportDto { justification?: string (1..1000) }`.
- `POST /imports/:id/rollback` ⇒ 202 `{ job }` (status `rolling_back`) ou 202 `{ status: 'pending', changeRequestId, job }`.
- `ImportJobsService.rollback(id, dto)`, `startRollback(job, actorUserId)`, `startApprovedRollback(jobId, approverUserId)`; `approvals.service` `case 'import_job.rollback'`.
- `ImportRollbacker.run(data: ImportQueueData)`; `ImportsQueueProcessor` `case 'rollback'`.

- [ ] **Step 1: Testes que falham:** reverter sem política ⇒ 202 `rolling_back`, mensagem `rollback` na fila depois do commit; rodar o worker ⇒ criado arquivado, atualizado com nome/preços antigos (histórico de preço `source import_rollback`), reativado com campos antigos e arquivado, ausente reativado; linhas com `rollbackResult` e `rolledBackAt`; job `rolled_back` com `rolledBackCount 4, conflictCount 0` e evento de auditoria `rollback`; **conflito no momento**: produto editado entre o POST e o worker fica como está e conta em `conflictCount`; **retomada**: worker que falha no 2º lote (`batchSize 1` + `beforeBatch` que lança) ⇒ job `completed` com `lastError`, linhas já revertidas ficam; nova reversão termina sem reverter duas vezes; `rolling_back` ⇒ 2º POST 409 `INVALID_STATE`; outra importação `applying` ⇒ 409 `IMPORT_IN_PROGRESS`; **aprovação**: com política de preço e 2 gerentes ⇒ 202 pendente, job continua `completed` com `rollbackRequestId`; aprovar ⇒ `rolling_back` e o worker reverte; recusar ⇒ job `completed`, reversível de novo.
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** Implementar. **Step 4:** `npm run test:int -- import`, `npm test`, tsc ⇒ PASS.
- [ ] **Step 5:** Commit — `feat(imports): reverter importação (worker em lotes, conflitos e aprovação)`

### Task 4: Painel

**Files:** Create `web-panel/src/components/imports/rollback-dialog.tsx` (+ spec); Modify `components/imports/result-step.tsx` (+ spec), `lib/imports.ts` (`RollbackPreview`, `canRollback(job, now?)`), `lib/approvals.ts` (+ spec), `lib/audit.ts` (rótulo `rollback` ⇒ "Reversão").

**Interfaces:**
- `canRollback(job): boolean` — `completed`, `appliedAt` ≤ 30 dias, sem `summary.rowsPurged`.
- `RollbackDialog({ job; open; onOpenChange(open); onStarted(job, pending) })`: busca `imports/:id/rollback-preview?page=&limit=20` (descarta resposta obsoleta); texto "{restore} alterações serão desfeitas." e, se houver, "{conflicts} produtos mudaram depois da importação e ficam como estão." com tabela (Código, Produto, Motivo: "Alterado depois"/"Excluído"); botão "Reverter importação" ⇒ `approval.execute(j => api.post('imports/:id/rollback', { justification: j }))`; 409 ⇒ mensagem em `role="alert"`.
- `ResultStep`: em `completed` com `canRollback`, botão "Reverter importação" abre o diálogo; `rolling_back` ⇒ "Revertendo a importação…"; `rolled_back` ⇒ "Importação revertida." + cartões "Desfeitas" (`rolledBackCount`) e "Mantidas (mudaram depois)" (`conflictCount`) + "Nova importação"; `lastError` de reversão que falhou aparece no `completed`.
- `describeRequest` com `operation 'rollback'` ⇒ `['Reverter a importação']`.

- [ ] **Step 1: Testes que falham** (`rollback-dialog.spec.tsx`, `result-step.spec.tsx`, `approvals.spec.ts`, `imports.spec.ts`): prévia com conflitos e paginação; resposta atrasada da página 1 depois de ir à 2 não aparece; reverter chama a API e `onStarted(job,false)`; `JUSTIFICATION_REQUIRED` ⇒ diálogo de justificativa e reenvio; pendente ⇒ `onStarted(job,true)`; `ROLLBACK_EXPIRED` ⇒ mensagem; botão some quando `appliedAt` > 30 dias; estados `rolling_back`/`rolled_back`; `describeRequest` do rollback; `canRollback`.
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** Implementar. **Step 4:** `npm test`, `npx tsc --noEmit` ⇒ PASS.
- [ ] **Step 5:** Commit — `feat(web): reverter importação no assistente`

### Task 5: Verificação e documentação

- [ ] **Step 1:** Suítes completas (backend unit/int/tsc/build; web test/tsc); remontar o container.
- [ ] **Step 2:** Ponta a ponta contra o container (token de teste local, como na 3.3): importar uma planilha pequena, reverter, conferir o catálogo e o job `rolled_back`; no navegador, se o login estiver disponível, o botão e o diálogo.
- [ ] **Step 3:** Documentar (spec seção 9 — **SP3 concluído**; mestre seção 10) e commit — `docs: SP3 etapa 3.4 concluída`.

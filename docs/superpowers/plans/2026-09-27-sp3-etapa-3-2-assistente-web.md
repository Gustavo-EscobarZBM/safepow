# SP3 etapa 3.2 — Assistente de importação no painel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o gerente importa produtos pelo painel num assistente de passos (arquivo → colunas → simulação → confirmação → resultado), acompanha o histórico em `/cadastros/importacoes`, e a tela de produtos deixa de ter o card antigo; o endpoint antigo sai do backend.

**Architecture:** um componente orquestrador `ImportWizard` deriva o passo do `status` do job (fonte da verdade no backend) e consulta `GET /imports/:id` a cada 2 s enquanto `simulating`/`applying`; cada passo é um componente próprio em `components/imports/`, testado isolado com `api` mockado. Toda lista paginada descarta resposta obsoleta (padrão `latestRequest` de `use-product-search.ts`). A confirmação usa o `useApprovalFlow` do SP2.

**Tech Stack:** Next.js (app router) + React + Tailwind + shadcn/ui (`components/ui`), vitest + Testing Library + user-event; backend NestJS (pequenos ajustes).

**Spec:** `docs/superpowers/specs/2026-09-26-sp3-importacao-exportacao-design.md` (seção 6; seção 3 para os contratos; seção 7 linha 3.2)

## Global Constraints

- Textos em português; datas/valores com `formatDateTimeBR`/`formatBRL` (`lib/audit.ts`, `lib/format.ts`).
- Chamadas só por `api` (`lib/api-client.ts`): `api.postForm` (upload), `api.post`, `api.get`, `api.getBlob` (relatório CSV e modelo).
- Consulta de status a cada **2 s** só em `simulating`/`applying`; parar ao desmontar.
- Toda busca que pode ser trocada rápido (filtro de linhas, página, histórico) descarta resposta obsoleta.
- Componentes client (`'use client'`) com arquivo `.spec.tsx` ao lado; `npm test` (vitest) e `npx tsc --noEmit` no `web-panel`.
- Backend: `npm test`, `npm run test:int` (nunca em paralelo), `npx tsc --noEmit -p tsconfig.json`.
- Nunca `git add -A` na raiz.

## Review Focus

1. **Recarregar a página no meio** (F5 na simulação ou na gravação): `/cadastros/importacoes/[id]` retoma no passo certo pelo status — Task 5 (teste por status).
2. **Troca rápida de filtro/página** na tabela da simulação: a resposta atrasada de um filtro anterior não pode aparecer — Task 4 (teste de resposta atrasada).
3. **409 da confirmação** (`ARCHIVE_CONFIRMATION_REQUIRED`, `JUSTIFICATION_REQUIRED`, `IMPORT_IN_PROGRESS`): cada um tem saída clara na tela, nada fica girando — Task 4.
4. **Planilha com muitas colunas / cabeçalhos longos**: selects e amostra com rolagem horizontal, sem estourar o layout — Task 3 (amostra dentro de contêiner `overflow-x-auto`, teste checa o contêiner).
5. **Gravação falhou** (`failed` com `applyStartedAt`) × **simulação falhou** (sem): botões diferentes ("Tentar de novo" × "Ajustar colunas") — Task 5.

---

## File Structure

```
backend/src/modules/imports/
  import-jobs.service.ts          (mod) preview devolve `fields`; remove legacyImport/legacyStatus
  imports.controller.ts, dto/column-mapping.dto.ts (remover)
  imports-queue.processor.ts      (mod) remove prepareAutoApply/autoApply
  imports.module.ts               (mod)
  import-legacy-and-history.http.int-spec.ts → import-history.http.int-spec.ts (sem os casos da tela antiga)
web-panel/src/
  lib/imports.ts (+ .spec)        tipos, rótulos, stepForJob, download helper
  lib/types.ts                    (mod) ImportJob novo
  components/imports/upload-step.tsx (+ .spec)
  components/imports/mapping-step.tsx (+ .spec)
  components/imports/simulation-step.tsx (+ .spec)
  components/imports/result-step.tsx (+ .spec)
  components/imports/import-wizard.tsx (+ .spec)
  app/(protected)/cadastros/importacoes/page.tsx (+ .spec)         histórico
  app/(protected)/cadastros/importacoes/nova/page.tsx
  app/(protected)/cadastros/importacoes/[id]/page.tsx
  app/(protected)/cadastros/produtos/page.tsx (+ .spec)             remove card antigo, botão Importar
  app/(protected)/aprovacoes/aprovacoes-client.tsx (+ .spec), lib/approvals.ts (+ .spec)  pedido import_job
  components/nav.tsx (+ .spec)                                        link Importações
```

---

### Task 1: Backend — `fields` na prévia e saída do endpoint antigo

**Files:** Modify `backend/src/modules/imports/import-jobs.service.ts`, `imports-queue.processor.ts`, `imports.module.ts`, `import-job.entity.ts` (`ImportOptions.autoApply` sai); Delete `imports.controller.ts`, `dto/column-mapping.dto.ts`; Rename test `import-legacy-and-history.http.int-spec.ts` → `import-history.http.int-spec.ts`; Modify `import-upload.http.int-spec.ts`.

**Interfaces:** `PreviewResult` ganha `fields: { key; label; required; updatable }[]` (o mesmo de `UploadResult`, que passa a herdar dele).

- [ ] **Step 1:** Teste que falha em `import-upload.http.int-spec.ts`: `POST /imports/:id/preview` devolve `fields` com 5 itens. No teste de histórico: remover os 4 casos "tela antiga" e o `drainQueue`; acrescentar `POST /api/products/import` ⇒ 404.
- [ ] **Step 2:** `npm run test:int -- import-upload import-history` ⇒ FAIL (sem `fields`; rota antiga ainda existe).
- [ ] **Step 3:** Implementar: `previewOf` devolve `fields`; remover `legacyImport`, `legacyStatus`, `ImportsController`, `ColumnMappingDto`, `prepareAutoApply` e `AUTO_APPLY_NEEDS_APPROVAL` (processor volta a só `simulate`/`apply`), `autoApply` de `simulate` e de `ImportOptions`.
- [ ] **Step 4:** `npm run test:int -- import` e `npx tsc --noEmit -p tsconfig.json` ⇒ PASS.
- [ ] **Step 5:** Commit — `refactor(imports): prévia devolve os campos; sai o endpoint antigo /products/import`

### Task 2: Base do painel — tipos, rótulos, navegação e passo "Arquivo"

**Files:** Create `web-panel/src/lib/imports.ts` (+ `.spec.ts`), `web-panel/src/components/imports/upload-step.tsx` (+ `.spec.tsx`); Modify `web-panel/src/lib/types.ts`, `web-panel/src/components/nav.tsx` (+ spec).

**Interfaces (Produces, `lib/imports.ts`):**
- Tipos: `ImportJobStatus` (12 status), `RowAction`, `ImportJob` (campos da spec 1.1 usados na tela: `id, status, resource, fileName, format, sheetName, sheets, headers, mapping, options, summary, errorReport, errorReportKey, createdByUserId, changeRequestId, simulatedAt, appliedAt, lastError, createdAt, completedAt, totalRows, successCount, errorCount`), `ImportSummary`, `ImportField { key; label; required; updatable }`, `PreviewResult { headers; sample; suggestedMapping; matchedMapping; fields }`, `UploadResult extends PreviewResult { job; sheets; duplicateOf }`, `ImportRowView`, `MissingItem`, `Page<T> { items; total }`, `ImportListItem = ImportJob & { createdByName: string | null }`.
- `IMPORT_STATUS_LABELS: Record<ImportJobStatus, string>` — uploaded "Arquivo enviado", simulating "Simulando", simulated "Simulada", pending_approval "Aguardando aprovação", applying "Gravando", completed "Concluída", failed "Falhou", cancelled "Cancelada", rolling_back "Revertendo", rolled_back "Revertida", pending/processing "Processando".
- `ACTION_LABELS: Record<RowAction, string>` — create "Criar", update "Atualizar", reactivate "Reativar", unchanged "Sem mudança", error "Erro", duplicate "Repetida", archive "Arquivar".
- `WARNING_LABELS` (mesmos textos do backend `engine/report-csv.ts`).
- `type WizardStep = 'columns' | 'simulation' | 'result'`; `stepForJob(job: ImportJob): WizardStep` — `uploaded` ⇒ columns; `simulating`/`simulated` ⇒ simulation; `failed` sem `options.applyStartedAt` ⇒ columns; demais ⇒ result.
- `isPolling(status): boolean` — `simulating` | `applying` | `rolling_back`.
- `downloadBlob(blob: Blob, fileName: string): void` (mesmo padrão do `auditoria/page.tsx`).
- `describeDiff(diff): string[]` — `"Preço de venda: R$ 10,00 → R$ 12,00"`, `"Nome: Arroz → Arroz 5kg"`, `isActive` ⇒ `"Reativar"`; preços via `formatBRL`.
- `UploadStep({ onUploaded(result: UploadResult): void })`: input de arquivo (`accept=".xlsx,.csv"`, rótulo "Planilha (.xlsx ou .csv)"), botão "Enviar planilha" (desabilitado sem arquivo/durante envio), link-botão "Baixar modelo" (`api.getBlob('imports/template?resource=products')` ⇒ `downloadBlob(..., 'modelo-importacao-produtos.xlsx')`), erro do `ApiError` em `role="alert"`.

- [ ] **Step 1: Testes que falham** — `lib/imports.spec.ts` (`stepForJob` para cada status, incluindo `failed` com/sem `applyStartedAt`; `isPolling`; `describeDiff` com preço, nome e `isActive`); `upload-step.spec.tsx` (envia `FormData` com `file` e `resource=products` por `api.postForm('imports', …)` e chama `onUploaded`; erro 400 mostra a mensagem; "Baixar modelo" chama `api.getBlob('imports/template?resource=products')`); `nav.spec.tsx` (gerente vê "Importações" → `/cadastros/importacoes`).
- [ ] **Step 2:** `npx vitest run src/lib/imports.spec.ts src/components/imports src/components/nav.spec.tsx` ⇒ FAIL.
- [ ] **Step 3:** Implementar; `lib/types.ts` passa a reexportar `ImportJob` de `lib/imports.ts` (o tipo antigo sai junto com o card na Task 6).
- [ ] **Step 4:** Mesmo comando ⇒ PASS.
- [ ] **Step 5:** Commit — `feat(web): base do assistente de importação e passo de envio do arquivo`

### Task 3: Passo "Colunas"

**Files:** Create `web-panel/src/components/imports/mapping-step.tsx` (+ `.spec.tsx`).

**Interfaces:** `MappingStep({ job: ImportJob; preview: PreviewResult; sheets: string[]; onPreviewChange(p: PreviewResult): void; onSimulated(job: ImportJob): void })`.
- Aba: `<select aria-label="Aba da planilha">` só se `sheets.length > 1`; ao trocar ⇒ `api.post('imports/:id/preview', { sheetName })` ⇒ `onPreviewChange`.
- Para cada campo: `<select aria-label={label}>` com "— não importar —" + cabeçalhos; obrigatórios com "*"; valor inicial = `suggestedMapping`; se `matchedMapping`, aviso "Mapeamento salvo reconhecido: {name}".
- "Atualizar em produtos que já existem": checkbox por campo `updatable` mapeado (todos marcados por padrão; desmarcar campo desmapeado some).
- Amostra: tabela com os cabeçalhos e até 20 linhas, dentro de `<div data-testid="sample-scroll" className="overflow-x-auto">`.
- "Salvar este mapeamento como" (input opcional, máx. 80).
- "Simular importação": valida obrigatórios no cliente ("Escolha a coluna de Código de barras e de Nome.") e cabeçalho repetido ("A coluna X foi escolhida para dois campos."); `api.post('imports/:id/simulate', { sheetName, mapping, updateFields, saveMappingAs? })` ⇒ `onSimulated(body.job)`; erro do backend em `role="alert"`.

- [ ] **Step 1: Testes que falham** — pré-seleção da sugestão; aviso de mapeamento salvo; trocar aba chama preview e `onPreviewChange`; simular sem Nome ⇒ mensagem e nenhuma chamada; mesma coluna em dois campos ⇒ mensagem; simular envia `mapping` só com campos mapeados, `updateFields` dos marcados, `saveMappingAs` quando preenchido; desmarcar "Custo" tira `costPrice` de `updateFields`; erro 400 aparece; amostra dentro de `sample-scroll`.
- [ ] **Step 2:** `npx vitest run src/components/imports/mapping-step.spec.tsx` ⇒ FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** ⇒ PASS.
- [ ] **Step 5:** Commit — `feat(web): passo de colunas do assistente de importação`

### Task 4: Passo "Simulação" + confirmação

**Files:** Create `web-panel/src/components/imports/simulation-step.tsx` (+ `.spec.tsx`).

**Interfaces:** `SimulationStep({ job: ImportJob; onBack(): void; onConfirmed(job: ImportJob, pending: boolean): void })`.
- Enquanto `simulating`: "Simulando a planilha…" (o wizard faz o polling).
- `simulated`: cartões com `summary.counts` (Criar, Atualizar, Reativar, Sem mudança, Erros, Repetidas) e total de avisos; lista de avisos por código com `WARNING_LABELS`.
- Tabela de linhas: abas de filtro (Todas, Criar, Atualizar, Reativar, Sem mudança, Erros, Avisos, Repetidas) ⇒ `api.get('imports/:id/rows?action=…&page=…&limit=20')`; colunas Linha, Código, Ação, Mudanças (`describeDiff`), Erros/avisos; `Pagination` existente; descarta resposta obsoleta.
- Ausentes: "N produtos ativos não estão na planilha" + botão "Ver lista" ⇒ `api.get('imports/:id/missing?page=1&limit=20')` (nome, código, "tem perdas").
- "Baixar relatório (CSV)" quando `errorReportKey` ⇒ `api.getBlob('imports/:id/report.csv')` ⇒ `downloadBlob`.
- "Voltar e ajustar colunas" ⇒ `onBack()`.
- Confirmação: checkbox "Arquivar os N produtos ausentes" (só se `missingCount > 0`); botão "Confirmar importação" ⇒ `approval.execute(j => api.post('imports/:id/apply', { archiveMissing, confirmArchiveCount?, justification: j }), outcome => …)`:
  - 202 aplicado ⇒ `onConfirmed(body.job, false)`; pendente ⇒ `onConfirmed(body.job, true)`;
  - 409 `ARCHIVE_CONFIRMATION_REQUIRED` ⇒ mostra `role="alertdialog"`/caixa com o texto do backend + input "Digite {missingCount} para confirmar" e botão "Confirmar arquivamento" (habilita só com o número exato) ⇒ reenvia com `confirmArchiveCount`;
  - 409 `IMPORT_IN_PROGRESS`/outros ⇒ mensagem em `role="alert"` e botão volta a habilitar.

- [ ] **Step 1: Testes que falham** — cartões; trocar para "Atualizar" busca `action=update` e mostra o diff formatado; resposta atrasada de "Todas" depois de clicar "Erros" não sobrescreve (duas promessas controladas); "Ver lista" de ausentes; relatório baixa via `getBlob`; confirmar simples chama `apply` com `{ archiveMissing: false }` e `onConfirmed(job,false)`; `JUSTIFICATION_REQUIRED` abre o diálogo e o reenvio leva `justification`; resposta pendente chama `onConfirmed(job,true)`; `ARCHIVE_CONFIRMATION_REQUIRED` pede o número e reenvia com `confirmArchiveCount`; `IMPORT_IN_PROGRESS` mostra a mensagem e reabilita o botão.
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** Implementar. **Step 4:** ⇒ PASS.
- [ ] **Step 5:** Commit — `feat(web): simulação e confirmação no assistente de importação`

### Task 5: Passo "Resultado", orquestrador e rotas

**Files:** Create `components/imports/result-step.tsx` (+ spec), `components/imports/import-wizard.tsx` (+ spec), `app/(protected)/cadastros/importacoes/nova/page.tsx`, `app/(protected)/cadastros/importacoes/[id]/page.tsx`.

**Interfaces:**
- `ResultStep({ job: ImportJob; onJobChange(job): void; onAdjustColumns(): void })`: `applying` ⇒ barra "Gravando: X de Y linhas" (`summary.appliedCount` / linhas aplicáveis = create+update+reactivate+unchanged); `pending_approval` ⇒ "Aguardando aprovação de outro gerente." + link "Ver pedidos" (`/aprovacoes`) + "Cancelar importação"; `completed` ⇒ contagens finais (criados/atualizados/reativados/sem mudança/arquivados/erros) + relatório + "Ver produtos" (`/cadastros/produtos`) + "Nova importação"; `failed` com `applyStartedAt` ⇒ `lastError` + "Tentar de novo" (`POST imports/:id/retry` ⇒ `onJobChange(body.job)`) + "Cancelar"; `failed` sem ⇒ `lastError` + "Ajustar colunas" (`onAdjustColumns`); `cancelled` ⇒ `lastError` ou "Importação cancelada." + "Nova importação".
- `ImportWizard({ jobId?: string })`: sem `jobId` mostra `UploadStep`; com job, passo = `stepForJob(job)` (ou `columns` quando o usuário clicou "Voltar"/"Ajustar colunas"); para `columns` sem `preview` em memória chama `POST imports/:id/preview { sheetName: job.sheetName ?? '' }`; polling `GET imports/:id` a cada 2 s enquanto `isPolling`; indicador de passos (Arquivo · Colunas · Simulação · Resultado) com o atual marcado `aria-current="step"`; aviso `duplicateOf` ("Esta planilha já foi importada em DD/MM por Fulano.") logo após o upload; `approval.notice` do SP2 quando pendente.
- `nova/page.tsx` ⇒ `<ImportWizard />`; `[id]/page.tsx` ⇒ `<ImportWizard jobId={params.id} />`; ambas com título "Importar produtos" e link "Histórico de importações".

- [ ] **Step 1: Testes que falham** — `result-step.spec` (cada status acima; retry chama a API e `onJobChange`; cancelar chama `imports/:id/cancel`); `import-wizard.spec` (com fake timers: job `uploaded` abre Colunas chamando preview; `simulating` → polling → `simulated` mostra a simulação; `applying` → `completed` mostra o resultado e para de consultar; F5 simulado: montar com `jobId` de job `simulated` abre direto a simulação; upload com `duplicateOf` mostra o aviso).
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** Implementar. **Step 4:** ⇒ PASS.
- [ ] **Step 5:** Commit — `feat(web): resultado, orquestrador e rotas do assistente de importação`

### Task 6: Histórico, página de produtos e fila de aprovações

**Files:** Create `app/(protected)/cadastros/importacoes/page.tsx` (+ spec); Modify `app/(protected)/cadastros/produtos/page.tsx` (+ spec), `lib/approvals.ts` (+ spec), `app/(protected)/aprovacoes/aprovacoes-client.tsx` (+ spec), `lib/types.ts`.

- Histórico: `GET imports?resource=products&page=&limit=20` (descarta obsoleta); tabela Data, Arquivo, Autor, Situação (`IMPORT_STATUS_LABELS` em `Badge`), Linhas, Resultado (criados/atualizados/erros quando houver `summary`), ação "Abrir" (link `/cadastros/importacoes/{id}`); botão "Nova importação" (link `/cadastros/importacoes/nova`); `Pagination`; estado vazio "Nenhuma importação ainda.".
- Produtos: remove o card "Importar planilha de produtos" e todo o estado de importação/polling; no cabeçalho, botão-link "Importar planilha" → `/cadastros/importacoes/nova`.
- Aprovações: `describeRequest` para `operation === 'import'` ⇒ `['Importar a planilha' + (payload.archiveMissing ? ' e arquivar os produtos ausentes' : '')]`; no cartão do pedido com `entityType === 'import_job'`, link "Ver simulação" → `/cadastros/importacoes/{entityId}`.

- [ ] **Step 1: Testes que falham** — histórico (lista, badge, link "Abrir", paginação, resposta obsoleta ao trocar de página, vazio); produtos (não existe mais "Importar planilha de produtos"; link "Importar planilha" aponta para `/cadastros/importacoes/nova`; nenhuma chamada a `products/import`); approvals (`describeRequest` do pedido de importação; link "Ver simulação").
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** Implementar. **Step 4:** `npm test` e `npx tsc --noEmit` (web) ⇒ PASS.
- [ ] **Step 5:** Commit — `feat(web): histórico de importações; produtos e aprovações apontam para o assistente`

### Task 7: Verificação no navegador e documentação

- [ ] **Step 1:** Suítes: web `npm test` + `npx tsc --noEmit`; backend `npm test`, `npm run test:int`, tsc, build.
- [ ] **Step 2:** Navegador (preview `web-panel` + `backend`, login "Entrar como Gerente"): Cadastros › Importações › Nova importação; baixar modelo; enviar uma planilha (arquivo gerado no scratchpad, selecionado no input); colunas pré-selecionadas; simular; ver cartões/linhas/filtro; confirmar; resultado concluído; histórico lista a importação; produto aparece em Produtos; tema escuro; largura de celular (375 px) sem rolagem horizontal da página. Capturas.
- [ ] **Step 3:** Documentar (spec seção 9, mestre seção 10) e commit — `docs: SP3 etapa 3.2 concluída`.

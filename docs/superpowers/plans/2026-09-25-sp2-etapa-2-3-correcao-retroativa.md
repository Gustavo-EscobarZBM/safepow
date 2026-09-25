# SP2 — Etapa 2.3: Correção retroativa de preço — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O gerente corrige o valor congelado das perdas de um produto num período ("digitei R$ 1,20 em vez de
R$ 12,00"), vê a prévia do impacto, informa a justificativa e — se a política `retro_fix` pedir — o pedido vai
para aprovação; o dashboard passa a mostrar o valor corrigido e a correção fica na auditoria como um evento só.

**Architecture:** Backend: um módulo `products-retro-fix.ts` (validação da janela e cálculo do impacto por SQL
agregado) usado por dois métodos novos de `ProductsService` (`retroFixPreview`, `retroFix`); `retroFix` passa
pelo portão de aprovação da 2.2 (`applyApprovalGate`, política `retro_fix`) e grava em modo resumo com um único
evento `retro_fix`. `ApprovalsService` aprende a reaplicar e a detectar conflito desse pedido. Painel: diálogo
"Corrigir valores de perdas passadas" a partir da edição do produto, com prévia e justificativa. Sem migration
(`valuationSource = 'recalculated'` e a ação `retro_fix` já existem no banco).

**Tech Stack:** NestJS 10 + TypeORM 0.3 + Postgres 16 (RLS); Next.js 14 + React 18; Jest (backend) e vitest (web).

**Spec:** `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md`, seção 4 (e seção 3 para
o contrato de aprovação).

## Global Constraints

- `GET /products/:id/retro-fix/preview?from=&to=&unitPrice=&costPrice=` (gerente) → `{ affectedLosses,
  currentTotal, newTotal, currentCostTotal, newCostTotal }` (números com 2 casas; totais = soma de `quantity ×
  valor unitário`).
- `POST /products/:id/retro-fix { from, to?, unitPrice, costPrice, justification }` (gerente) → 200 com o mesmo
  formato da prévia (valores efetivamente aplicados) ou 202 `{ status: 'pending', changeRequestId, policy:
  'retro_fix' }`.
- Perdas afetadas: do produto, `occurredAt` em `[from, to ?? agora]` (inclusivo). Grava `unitPriceAtLoss`,
  `unitCostAtLoss` e `valuationSource = 'recalculated'`.
- Justificativa **sempre** obrigatória (mín. 10 caracteres após `trim`, máx. 1000) — com ou sem política.
- Política `retro_fix` ligada: 1 gerente ⇒ segue (evento `justify` + motivo); ≥ 2 ⇒ pedido de aprovação.
- Modo resumo (`app.audit_mode = 'summary'`): nenhuma linha de auditoria por perda; **um** evento `retro_fix`
  no produto (`entityType 'product'`) com `summary { from, to, unitPrice, costPrice, affectedLosses,
  currentTotal, newTotal, currentCostTotal, newCostTotal }` e `reason` = justificativa.
- **Não** altera `product_price_history` nem o preço atual do produto.
- Janela: máx. **366 dias**; `from` não pode ser futuro; `to` ≥ `from`; `unitPrice`/`costPrice` ≥ 0.
  Mensagens (400): "A data inicial não pode ser futura.", "A data final não pode ser anterior à inicial.", "A
  janela máxima é de 366 dias por correção."
- Datas: validar com `@IsDateString()` + o validador de data interpretável usado em `QueryAuditDto`
  (`20260924` ⇒ 400, não 500).
- Painel: ação "Corrigir valores de perdas passadas" no diálogo de edição do produto, com prévia do impacto.
- Baselines: backend 23 suítes/161 unit, 27 arquivos/176 integração; web 45 arquivos/227.
- Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Perda de outro produto ou fora da janela** (um dia antes de `from`, um dia depois de `to`) ⇒ intacta. → Task 2.
2. **Pedido de correção aprovado depois que uma perda nova entrou na janela** ⇒ pedido `expired` ("O registro
   mudou desde o pedido."), nada aplicado. → Task 3.
3. **Correção aplicada duas vezes** (mesmos valores) ⇒ segunda vez afeta as mesmas perdas, totais iguais antes e
   depois, sem erro. → Task 2.
4. **Janela sem nenhuma perda** ⇒ 200 com `affectedLosses: 0` e o evento registrado (a intenção fica na
   auditoria); o painel mostra "Nenhuma perda no período" e não deixa aplicar. → Tasks 2 e 4.
5. **Gerente de outra empresa** com o id do produto ⇒ 404 na prévia e na aplicação. → Task 2.

---

### Task 1: Validação da janela e cálculo do impacto

**Files:** Create `backend/src/modules/products/products-retro-fix.ts`, `products-retro-fix.spec.ts`,
`backend/src/common/validators/is-parsable-date.ts`, `backend/src/modules/products/dto/retro-fix.dto.ts`;
Modify `backend/src/modules/audit/dto/query-audit.dto.ts` (passa a importar o validador compartilhado).

**Interfaces:**
- Produces: `IsParsableDate()` (movido de `query-audit.dto.ts` para `common/validators/is-parsable-date.ts`,
  mesma mensagem); `RetroFixQueryDto { from: string; to?: string; unitPrice: number; costPrice: number }`
  (query: `@Type(() => Number)` nos números, `@Min(0)`); `RetroFixDto extends RetroFixQueryDto { justification:
  string }` (obrigatória, `trim`, 10–1000); `interface RetroFixWindow { from: Date; to: Date }`;
  `resolveRetroFixWindow(from: string, to: string | undefined, now: Date): RetroFixWindow` (lança
  `BadRequestException` com as mensagens das Global Constraints); `interface RetroFixImpact { affectedLosses:
  number; currentTotal: number; newTotal: number; currentCostTotal: number; newCostTotal: number }`;
  `computeRetroFixImpact(manager: EntityManager, productId: string, window: RetroFixWindow, unitPrice: number,
  costPrice: number): Promise<RetroFixImpact>` (uma consulta agregada em `losses`: `count(*)`,
  `sum(quantity * "unitPriceAtLoss")`, `sum(quantity * "unitCostAtLoss")`, `sum(quantity)`; novos totais =
  `sum(quantity) × valor`; tudo arredondado a 2 casas).

- [ ] **Step 1: Testes unitários (vão falhar)** — `products-retro-fix.spec.ts` para `resolveRetroFixWindow`
  com `now = new Date('2026-09-25T15:00:00Z')`:
  - `('2026-09-01T00:00:00Z', undefined, now)` ⇒ `{ from: 2026-09-01T00:00Z, to: now }`.
  - `('2026-09-26T00:00:00Z', …)` ⇒ lança "A data inicial não pode ser futura.".
  - `('2026-09-10T00:00:00Z', '2026-09-01T00:00:00Z', now)` ⇒ "A data final não pode ser anterior à inicial.".
  - `('2025-09-01T00:00:00Z', '2026-09-02T00:00:00Z', now)` (366 dias + 1 dia) ⇒ "A janela máxima é de 366 dias
    por correção."; `('2025-09-24T15:00:00Z', undefined, now)` (exatamente 366 dias) ⇒ ok.
- [ ] **Step 2: Rodar e ver falhar** — `cd /c/PROJETOS/SAAS/backend && npx jest src/modules/products/products-retro-fix.spec.ts`
  Expected: FAIL `Cannot find module './products-retro-fix'`.
- [ ] **Step 3: Implementar** os arquivos da Interfaces; em `query-audit.dto.ts` trocar a função local pelo import.
- [ ] **Step 4: Rodar e commit** — o spec novo PASS; `npm test` verde (os testes da auditoria seguem passando);
  `npx tsc --noEmit -p tsconfig.json` exit 0.
```bash
git add src/modules/products/products-retro-fix.ts src/modules/products/products-retro-fix.spec.ts src/common/validators/is-parsable-date.ts src/modules/products/dto/retro-fix.dto.ts src/modules/audit/dto/query-audit.dto.ts
git commit -m "feat(backend): janela e impacto da correção retroativa de preço" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prévia e aplicação (`/products/:id/retro-fix`)

**Files:** Modify `backend/src/modules/products/products.service.ts`, `products.controller.ts`,
`backend/src/modules/approvals/approval-gate.ts` (`GateInput.operation` aceita `'retro_fix'`); Create
`backend/src/modules/products/products-retro-fix.http.int-spec.ts`.

**Interfaces:**
- Consumes: Task 1; `applyApprovalGate`, `loadCompanyPolicies`, `GateOptions`, `PendingApproval`,
  `isPendingApproval` (2.2.1); `recordAuditEvent` (2.1.1); helpers de `src/test-utils/approvals-test-app.ts`
  (`startApprovalsApp`, `http`, `tokenFor`, `seedUser`, `seedLoss`, `setPolicies`).
- Produces: `ProductsService.retroFixPreview(id: string, query: RetroFixQueryDto): Promise<RetroFixImpact>`;
  `ProductsService.retroFix(id: string, dto: RetroFixDto, options?: GateOptions): Promise<RetroFixImpact |
  PendingApproval>`; `retroFixSnapshot(impact: RetroFixImpact): Record<string, unknown>` (exportada: `{
  affectedLosses, currentTotal, currentCostTotal }` como strings `toFixed(2)`/inteiro — usada no pedido e na
  aprovação); rotas `GET :id/retro-fix/preview` e `POST :id/retro-fix` (`@Roles(MANAGER)`, `ParseUUIDPipe`;
  POST com `@Res()` devolvendo 202 no pendente e 200 senão, como o `PATCH :id`).
- `retroFix`: acha o produto (404) → resolve a janela → calcula o impacto atual → se `!skipPolicy` e a política
  `retro_fix` estiver ligada ⇒ `applyApprovalGate({ policy: 'retro_fix', entityType: 'product', entityId,
  entityLabel: product.name, operation: 'retro_fix', payload: { from, to (resolvido, ISO), unitPrice,
  costPrice }, snapshot: retroFixSnapshot(impact), justification })` e devolve o pendente se houver → senão:
  `set_config('app.audit_reason', justification)` e `set_config('app.audit_mode', 'summary')`, `UPDATE losses …
  WHERE "productId" = $ AND "occurredAt" BETWEEN $from AND $to`, `recordAuditEvent(action 'retro_fix', summary
  das Global Constraints)` e devolve o impacto calculado antes do UPDATE (com `newTotal`/`newCostTotal`).

- [ ] **Step 1: Testes de integração (vão falhar)** — `products-retro-fix.http.int-spec.ts` com
  `startApprovalsApp()`; empresa com 1 gerente; produto "Arroz" (preço atual 12); perdas semeadas com
  `seedLoss` e depois ajustadas por `adminQuery` (`quantity`, `occurredAt`, `"unitPriceAtLoss" = 1.20`,
  `"unitCostAtLoss" = 0.80`): duas dentro da janela `[2026-09-01, 2026-09-20]` (quantidades 2 e 3), uma em
  2026-08-31 (fora), uma de outro produto dentro da janela.
  - prévia `unitPrice=12&costPrice=8` ⇒ `{ affectedLosses: 2, currentTotal: 6, newTotal: 60, currentCostTotal: 4,
    newCostTotal: 40 }`.
  - POST com justificativa ⇒ 200 com o mesmo corpo da prévia; as 2 perdas ficam com 12,00/8,00 e
    `valuationSource 'recalculated'`; a de 31/08 e a do outro produto intactas (1,20 / valuationSource antigo).
  - auditoria: exatamente **um** evento novo para o produto, `action 'retro_fix'`, `reason` = justificativa,
    `summary` com `affectedLosses: 2` e os totais; nenhuma linha `update` de `loss` gravada pelo POST.
  - `product_price_history` com a mesma quantidade de linhas de antes; `products.unitPrice` continua 12.
  - relatório reflete: `GET /api/losses/reports/by-product` ⇒ linha do "Arroz" com `totalFinancialLoss` 60
    (usar `Number(...)`).
  - aplicar de novo com os mesmos valores ⇒ 200, `affectedLosses: 2`, `currentTotal = newTotal = 60`.
  - janela sem perdas (`from=2026-07-01&to=2026-07-10`) ⇒ 200 `affectedLosses: 0` e o evento registrado.
  - sem justificativa ou com 9 caracteres ⇒ 400; `from` futuro ⇒ 400 com a mensagem; `from=20260924` ⇒ 400;
    janela de 400 dias ⇒ 400; `unitPrice=-1` ⇒ 400.
  - funcionário ⇒ 403; gerente de outra empresa ⇒ 404 na prévia e no POST.
  - política `retro_fix` ligada + 2 gerentes ⇒ 202 `{ status: 'pending', policy: 'retro_fix' }`, perdas
    intactas, pedido com `operation 'retro_fix'` e `payload.to` preenchido mesmo sem `to` no corpo.
- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- src/modules/products/products-retro-fix.http.int-spec.ts`
  Expected: FAIL (404 nas rotas novas).
- [ ] **Step 3: Implementar** conforme Interfaces.
- [ ] **Step 4: Rodar e commit** — spec novo PASS; `npm test` e `npm run test:int` verdes; `tsc` exit 0.
```bash
git add src/modules/products src/modules/approvals/approval-gate.ts
git commit -m "feat(backend): prévia e aplicação da correção retroativa de preço (resumo na auditoria, portão retro_fix)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Aprovação do pedido de correção

**Files:** Modify `backend/src/modules/approvals/approvals.service.ts`; Modify
`backend/src/modules/approvals/change-requests.http.int-spec.ts` (novos casos).

**Interfaces:**
- Consumes: Task 2 (`retroFix`, `retroFixSnapshot`, `computeRetroFixImpact`, `resolveRetroFixWindow`).
- `apply`: novo caso `'product.retro_fix'` ⇒ `productsService.retroFix(entityId, { ...payload, justification:
  request.justification }, { skipPolicy: true })`.
- `currentSnapshot`: para `operation === 'retro_fix'`, recalcula `retroFixSnapshot(computeRetroFixImpact(…
  janela do payload, valores do payload))` em vez de `productSnapshot`.

- [ ] **Step 1: Testes (vão falhar)** — em `change-requests.http.int-spec.ts` (política `retro_fix` ligada, 2
  gerentes, perdas do "Arroz" a 1,20 na janela):
  - pedido criado por Ana, aprovado por Bruno ⇒ 200 `approved`; perdas com 12,00 e `recalculated`; um evento
    `retro_fix` com `reason` = justificativa original e `actorUserId` = Bruno; evento `approve`.
  - depois do pedido entra uma perda nova na janela (via `seedLoss` + `adminQuery`) ⇒ aprovar devolve 200 com
    `status: 'expired'`, nota "O registro mudou desde o pedido."; nenhuma perda alterada.
- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- src/modules/approvals/change-requests.http.int-spec.ts`
  Expected: os casos novos FAIL (`Tipo de pedido desconhecido.` / snapshot do produto).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e commit** — spec PASS; suítes verdes; `tsc` exit 0.
```bash
git add src/modules/approvals
git commit -m "feat(backend): aprovação de pedidos de correção retroativa (reaplica e detecta mudança na janela)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Painel — diálogo "Corrigir valores de perdas passadas"

**Files:** Create `web-panel/src/components/retro-fix-dialog.tsx`, `retro-fix-dialog.spec.tsx`; Modify
`web-panel/src/app/(protected)/cadastros/produtos/page.tsx` (+ `page.spec.tsx`), `web-panel/src/lib/types.ts`
(`RetroFixImpact`), `web-panel/src/lib/approvals.ts` (+ spec: `describeRequest` para `operation 'retro_fix'`),
`web-panel/src/lib/audit.ts` (+ spec: `describeEntry` para `action 'retro_fix'` e rótulo de ação "Correção
retroativa" já existente).

**Interfaces:**
- Consumes: rotas da Task 2; `isPendingApproval`, `PENDING_APPROVAL_NOTICE` (2.2.2); `MIN_JUSTIFICATION_LENGTH`
  de `justification-dialog.tsx`; `formatBRL`, `formatDateTimeBR`.
- Produces: `RetroFixDialog({ product: { id: string; name: string; unitPrice: number | string; costPrice: number
  | string } | null; open: boolean; onOpenChange: (open: boolean) => void; onApplied: (outcome: 'applied' |
  'pending', impact?: RetroFixImpact) => void })`.
- Diálogo: título "Corrigir valores de perdas passadas"; campos "De" e "Até" (`type="date"`; "Até" opcional =
  até agora), "Preço unitário (R$)" e "Custo (R$)" pré-preenchidos com o preço atual do produto; botão "Ver
  impacto" ⇒ `api.get('products/<id>/retro-fix/preview?' + query)` (datas convertidas para o início do dia de
  "De" e o fim do dia de "Até" no fuso do navegador, como `buildAuditQuery`); mostra "N perdas: R$ atual → R$
  novo (custo R$ → R$)" ou "Nenhuma perda no período."; `<textarea aria-label="Justificativa">` com o mesmo
  mínimo de 10; botão "Aplicar correção" habilitado só com prévia carregada, `affectedLosses > 0` e
  justificativa válida ⇒ `api.post('products/<id>/retro-fix', { from, to?, unitPrice, costPrice,
  justification })`; 202 ⇒ `onApplied('pending')`; 200 ⇒ `onApplied('applied', impacto)`; erro ⇒ mensagem no
  diálogo. Mudar datas ou valores invalida a prévia (precisa ver de novo).
- Página de produtos: botão "Corrigir valores de perdas passadas" no diálogo de edição (perto de "Histórico de
  alterações") abre o `RetroFixDialog`; `onApplied` mostra "Correção aplicada a N perdas." ou o aviso de
  pendente no topo (mesmo `role="status"` da 2.2.2).
- `describeRequest` (`operation 'retro_fix'`): `["Corrigir N perdas de <dd/mm/aaaa> a <dd/mm/aaaa>: preço
  R$ X, custo R$ Y"]` (N do `snapshot.affectedLosses`; datas e valores do `payload`).
- `describeEntry` (`action 'retro_fix'` com `summary`): `["N perdas de <data> a <data> corrigidas: R$ atual → R$
  novo"]`.

- [ ] **Step 1: Testes (vão falhar)** — `retro-fix-dialog.spec.tsx` (mock de `api.get`/`api.post`):
  - "Ver impacto" chama a prévia com `unitPrice=12&costPrice=8` e as datas convertidas; mostra "2 perdas" e
    `R$ 6,00 → R$ 60,00` (regex); "Aplicar correção" desabilitado até a justificativa ter 10 caracteres.
  - aplicar ⇒ `api.post('products/p-a/retro-fix', { from, to, unitPrice: 12, costPrice: 8, justification })` e
    `onApplied('applied', impacto)`.
  - resposta 202 (objeto pendente) ⇒ `onApplied('pending')`.
  - prévia com `affectedLosses: 0` ⇒ "Nenhuma perda no período." e "Aplicar correção" desabilitado.
  - mudar o preço depois da prévia ⇒ "Aplicar correção" desabilitado de novo.
  - erro 400 da API ⇒ mensagem no diálogo.
  - `page.spec.tsx`: no diálogo de edição, "Corrigir valores de perdas passadas" abre o diálogo com o título.
  - `approvals.spec.ts` e `audit.spec.ts`: as linhas descritas acima.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/components/retro-fix-dialog.spec.tsx src/lib "src/app/(protected)/cadastros/produtos/page.spec.tsx"`
  Expected: os casos novos FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e commit** — `npm test` verde; `npx tsc --noEmit` exit 0.
```bash
git add src/components/retro-fix-dialog.tsx src/components/retro-fix-dialog.spec.tsx "src/app/(protected)/cadastros/produtos" src/lib
git commit -m "feat(web): diálogo de correção retroativa de preço com prévia do impacto" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação no navegador e registro

- [ ] **Step 1: Verificar** (backend + painel no ar; sem migration nova): gerente demo → Produtos → editar um
  produto que tenha perdas → "Corrigir valores de perdas passadas" → período que contenha perdas, valores iguais
  aos **atuais** das perdas (para não alterar o dado demo) → "Ver impacto" (totais atual = novo) → justificativa →
  aplicar ⇒ mensagem "Correção aplicada a N perdas."; Auditoria mostra o evento "Correção retroativa" com a
  justificativa. Conferir no banco que o único efeito foi `valuationSource = 'recalculated'` nessas perdas
  (valores iguais). Console sem erros novos.
- [ ] **Step 2: Registrar** — no spec do SP2, fim da seção 4: "**Resultado da 2.3 (<data>):** …" (rotas,
  modo resumo com um evento, portão `retro_fix`, aprovação com detecção de mudança na janela, diálogo no painel).
  Na seção 10 do mestre, linha do SP2: etapa 2.3 e link do plano.
- [ ] **Step 3: Checagem final e commit** — `npm test` (backend e web), `npm run test:int`, `tsc` nos dois.
```bash
git add docs/superpowers/specs
git commit -m "docs: andamento do SP2 — etapa 2.3" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (seção 4):** prévia → Task 2 (+ cálculo na Task 1); aplicar com janela, valores,
`recalculated` → Task 2; justificativa sempre obrigatória → Task 1 (DTO) e Task 2 (testes); política/aprovação →
Tasks 2 e 3; modo resumo com um evento `retro_fix` e `reason` → Task 2; não mexe no histórico de preço → Task 2
(teste); janela de 366 dias e `from` não futuro → Task 1; painel com prévia → Task 4. Testes do spec (prévia bate
com o aplicado, só produto e janela, `valuationSource`, evento único, justificativa, política/aprovação,
dashboard reflete, RLS) → Tasks 2 e 3.

**Consistência:** `RetroFixImpact` com os nomes da spec (`currentTotal`, `newTotal`, `currentCostTotal`,
`newCostTotal`) no backend (Tasks 1–3) e no painel (Task 4); `operation 'retro_fix'` no portão (Task 2), no
`apply`/`currentSnapshot` (Task 3) e no `describeRequest` (Task 4); `retroFixSnapshot` é a mesma função no
pedido e na aprovação.

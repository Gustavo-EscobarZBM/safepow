# SP2 — Sub-etapa 2.2.2: Justificativa e aprovações (painel web) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar ao painel o que o backend da 2.2.1 já faz: o gerente liga/desliga as políticas, vê e decide
os pedidos numa página **Aprovações** (com selo de pendentes no menu), e ao editar preço, arquivar produto,
editar ou excluir perda recebe o diálogo de **justificativa** e o aviso **"Enviado para aprovação"**.

**Architecture:** Um módulo puro `src/lib/approvals.ts` (rótulos, detecção do 409/202, "de → para" do pedido
reaproveitando `describeChange` de `src/lib/audit.ts`). Um hook `useApprovalFlow` + componente
`JustificationDialog` encapsulam o ciclo "tenta → 409 → pede justificativa → reenvia → aplicado ou pendente",
usado igual nas 4 ações. Página `/aprovacoes` com a configuração das políticas (não existe página de
"Configurações da empresa" no painel — a configuração de conferência mora em Conferências) e a fila.

**Tech Stack:** Next.js 14 (app router, `'use client'`), React 18, Tailwind 3, shadcn/radix existentes
(`Dialog`, `Tabs`, `Checkbox`, `Button`, `Card`, `Input`, `Label`, `Badge`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md`, seção 3.5 (telas) e
3.6 (testes web); contrato do backend na seção 3 ("Resultado da 2.2.1").

## Global Constraints

- Contrato do backend (já em `main`):
  - 409 `{ errorCode: 'JUSTIFICATION_REQUIRED', policy, mode: 'approval' | 'justification', message }`;
  - 202 `{ status: 'pending', changeRequestId, policy }`;
  - campo `justification` (mín. 10 caracteres após `trim`, máx. 1000) em `PATCH/DELETE /products/:id` e
    `PATCH/DELETE /losses/:id` — no DELETE vai no **corpo**;
  - `GET /approval-policies` e `PUT /approval-policies` (corpo com as 4 políticas completas) →
    `{ policies, activeManagers, mode }`;
  - `GET /change-requests?status=pending|decided`, `GET /change-requests/pending-count` → `{ count }`,
    `POST /change-requests/:id/approve|reject` (corpo `{ note? }`), `POST /change-requests/:id/cancel`;
  - erros: 403 `SELF_APPROVAL` / `NOT_REQUESTER`, 409 `REQUEST_NOT_PENDING`; aprovar sobre registro alterado
    devolve **200** com `status: 'expired'` e `decisionNote`.
- Políticas e rótulos: `price_change` "Mudança de preço ou custo acima de X%", `retro_fix` "Correção
  retroativa de preço", `loss_edit` "Editar ou excluir perda registrada", `archive_with_history` "Arquivar
  produto que já tem perdas". Limite padrão 20.
- Texto do modo:
  - 1 gerente ativo: "Sua empresa tem 1 gerente ativo: as mudanças sensíveis pedirão justificativa.";
  - N ≥ 2: "Sua empresa tem N gerentes ativos: as mudanças sensíveis vão para aprovação de outro gerente."
- Aviso do 202: "Enviado para aprovação de outro gerente." Tudo em português; valores com `formatBRL`, datas com
  `formatDateTimeBR`.
- Página e selo só para gerente (`middleware.ts` já barra funcionário fora da lista branca).
- Comando de testes: `npm test` em `web-panel/` (baseline 42 arquivos / 191 testes); `npx tsc --noEmit`.
- Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Justificativa só com espaços ou curta** ⇒ o diálogo não envia (botão desabilitado com contador "mín. 10
   caracteres"), sem ida ao backend. → Task 2.
2. **Erro no reenvio com justificativa** (ex.: 409 de código de barras, 400) ⇒ a mensagem aparece **dentro**
   do diálogo, que continua aberto com o texto digitado. → Task 2.
3. **Cancelar o diálogo de justificativa** ⇒ nada é gravado, o diálogo de edição do produto/perda continua
   aberto com o que foi digitado. → Task 3.
4. **Aprovar pedido cujo registro mudou** (200 `expired`) ⇒ a página mostra a nota "O registro mudou desde o
   pedido." e o pedido sai da lista de pendentes. → Task 4.
5. **Pedido do próprio gerente** na fila ⇒ não mostra Aprovar/Recusar, só "Cancelar pedido". → Task 4.

---

## Estrutura de arquivos

- Create `web-panel/src/lib/approvals.ts`, `approvals.spec.ts`; Modify `src/lib/types.ts`, `src/lib/api-client.ts`
- Create `web-panel/src/components/justification-dialog.tsx`, `src/hooks/use-approval-flow.tsx`, `use-approval-flow.spec.tsx`
- Modify `src/app/(protected)/cadastros/produtos/page.tsx` (+ `page.spec.tsx`), `src/app/(protected)/losses/losses-client.tsx` (+ `losses-client.spec.tsx`)
- Create `src/app/(protected)/aprovacoes/page.tsx`, `aprovacoes-client.tsx`, `aprovacoes-client.spec.tsx`
- Modify `src/components/nav.tsx`, `nav.spec.tsx`
- Modify docs (Task 6)

---

### Task 1: Tipos, rótulos e detecção do contrato (`lib/approvals.ts`)

**Files:** Create `web-panel/src/lib/approvals.ts`, `web-panel/src/lib/approvals.spec.ts`; Modify
`web-panel/src/lib/types.ts`, `web-panel/src/lib/api-client.ts`.

**Interfaces:**
- Produces (`types.ts`): `type ApprovalPolicyKey = 'price_change' | 'retro_fix' | 'loss_edit' |
  'archive_with_history'`; `interface ApprovalPolicies { price_change: { enabled: boolean; thresholdPercent:
  number }; retro_fix: { enabled: boolean }; loss_edit: { enabled: boolean }; archive_with_history: { enabled:
  boolean } }`; `interface ApprovalPoliciesState { policies: ApprovalPolicies; activeManagers: number; mode:
  ApprovalMode }`; `type ApprovalMode = 'approval' | 'justification'`; `interface PendingApprovalResult {
  status: 'pending'; changeRequestId: string; policy: ApprovalPolicyKey }`; `type ChangeRequestStatus`;
  `interface ChangeRequest` (campos do `ChangeRequestView` do backend: `id, policy, entityType, entityId,
  entityLabel, operation, payload, snapshot, justification, status, requestedByUserId, requestedByName,
  decidedByUserId, decidedByName, decidedAt, decisionNote, expiresAt, createdAt`).
- Produces (`approvals.ts`): `POLICY_LABELS: Record<ApprovalPolicyKey, string>`, `PENDING_APPROVAL_NOTICE =
  'Enviado para aprovação de outro gerente.'`, `modeDescription(activeManagers: number): string`,
  `justificationRequired(error: unknown): { policy: ApprovalPolicyKey; mode: ApprovalMode; message: string }
  | null`, `isPendingApproval(value: unknown): value is PendingApprovalResult`, `describeRequest(request:
  ChangeRequest): string[]`.
- Produces (`api-client.ts`): `api.delete<T>(path: string, body?: unknown)`.

- [ ] **Step 1: Testes (vão falhar)** — `web-panel/src/lib/approvals.spec.ts`:
  - `modeDescription(1)` ⇒ texto de 1 gerente (Global Constraints); `modeDescription(3)` ⇒ "Sua empresa tem 3
    gerentes ativos: as mudanças sensíveis vão para aprovação de outro gerente."; `modeDescription(0)` ⇒ mesmo
    texto do modo justificativa com "0 gerentes ativos".
  - `justificationRequired(new ApiError(409, 'msg', { errorCode: 'JUSTIFICATION_REQUIRED', policy:
    'price_change', mode: 'approval' }))` ⇒ `{ policy: 'price_change', mode: 'approval', message: 'msg' }`;
    ⇒ `null` para `ApiError(409, 'x', { errorCode: 'PRODUCT_BARCODE_TAKEN' })`, para `ApiError(400, …)` e para
    `new Error('x')`.
  - `isPendingApproval({ status: 'pending', changeRequestId: 'c1', policy: 'loss_edit' })` ⇒ true; ⇒ false
    para `{ id: 'p1', name: 'Arroz' }`, `undefined`, `{ status: 'pending' }`.
  - `describeRequest` (monte um `ChangeRequest` de teste com um helper `request(overrides)`):
    - update de produto com `snapshot { unitPrice: '10.00', name: 'Arroz' }` e `payload { unitPrice: 15,
      name: 'Arroz' }` ⇒ `['Preço unitário: R$ 10,00 → R$ 15,00']` (campo igual é omitido — compare com
      `String()` normalizado por `Number` quando os dois lados são numéricos);
    - `operation: 'archive'` ⇒ `['Arquivar o produto']`; `entityType 'loss', operation 'delete'` ⇒ `['Excluir
      a perda']`;
    - update de perda `{ reasonId: 'x' }` vs snapshot `{ reasonId: 'y' }` ⇒ `['Motivo: alterado']`.
  (Usar `toMatch(/R\$\s?10,00 → R\$\s?15,00/)` onde houver moeda — o `Intl` pode usar espaço não separável.)

- [ ] **Step 2: Rodar e ver falhar** — `cd /c/PROJETOS/SAAS/web-panel && npx vitest run src/lib/approvals.spec.ts`
  Expected: FAIL `Failed to resolve import "./approvals"`.

- [ ] **Step 3: Implementar** — tipos em `types.ts` (fim do arquivo); `approvals.ts` com as funções acima
  (`describeRequest`: para `update`, uma linha por chave do `payload` cujo valor difere do `snapshot`, via
  `describeChange({ field, from: snapshot[field], to: payload[field] }, 'update')` de `@/lib/audit`; `archive`
  ⇒ "Arquivar o produto"; `delete` ⇒ "Excluir a perda"); em `api-client.ts`, `delete: <T>(path: string, body?:
  unknown) => request<T>('DELETE', path, body)`.

- [ ] **Step 4: Rodar e commit**
```bash
npx vitest run src/lib/approvals.spec.ts
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add src/lib/approvals.ts src/lib/approvals.spec.ts src/lib/types.ts src/lib/api-client.ts
git commit -m "feat(web): tipos, rótulos e detecção do contrato de aprovações" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; suíte verde (43 arquivos); `tsc exit=0`.

---

### Task 2: Diálogo de justificativa e hook `useApprovalFlow`

**Files:** Create `web-panel/src/components/justification-dialog.tsx`, `web-panel/src/hooks/use-approval-flow.tsx`,
`web-panel/src/hooks/use-approval-flow.spec.tsx`.

**Interfaces:**
- Consumes: `justificationRequired`, `isPendingApproval`, `PENDING_APPROVAL_NOTICE` (Task 1).
- Produces: `JustificationDialog({ open, mode, message, submitting, error, onSubmit: (text: string) => void,
  onCancel: () => void })`; `useApprovalFlow(): { execute(action: (justification?: string) =>
  Promise<unknown>, onDone: (outcome: 'applied' | 'pending') => void): Promise<void>; dialog: JSX.Element;
  notice: string | null; clearNotice(): void }`.
  - `execute`: chama `action()` sem justificativa; sucesso ⇒ `onDone('applied' | 'pending')` (pendente também
    põe `notice = PENDING_APPROVAL_NOTICE`); `justificationRequired(erro)` ⇒ abre o diálogo e guarda
    `action`/`onDone`; qualquer outro erro é **relançado** para quem chamou (a página mostra como sempre).
  - Confirmar no diálogo ⇒ `action(texto)`; sucesso ⇒ fecha e `onDone(...)`; erro ⇒ mensagem dentro do diálogo
    (`ApiError.message`), diálogo aberto com o texto.
  - Cancelar ⇒ fecha sem chamar `onDone`.
- Diálogo: título "Justificativa"; descrição = `message` do backend; `<textarea aria-label="Justificativa">`;
  contador "N/10 caracteres mínimos" enquanto `trim().length < 10`; botão principal "Enviar para aprovação"
  (mode `approval`) ou "Confirmar" (mode `justification`), desabilitado com menos de 10 caracteres úteis ou
  `submitting`; botão "Cancelar".

- [ ] **Step 1: Testes (vão falhar)** — `use-approval-flow.spec.tsx`, com um componente de teste que usa o
  hook e um botão "Salvar" chamando `execute(action, onDone)` (`action` e `onDone` são `vi.fn()`):
  - ação que resolve com objeto comum ⇒ `onDone('applied')`, nenhum diálogo, `notice` null.
  - ação que resolve com `{ status: 'pending', changeRequestId: 'c1', policy: 'loss_edit' }` ⇒
    `onDone('pending')` e o texto "Enviado para aprovação de outro gerente." visível.
  - 1ª chamada rejeita com o 409 `JUSTIFICATION_REQUIRED` (`mode: 'approval'`, message "Precisa de
    aprovação") ⇒ diálogo com "Precisa de aprovação"; botão "Enviar para aprovação" desabilitado com "curta" e
    com 12 espaços; digitar "Fornecedor reajustou" ⇒ habilitado; clicar ⇒ `action` chamada pela 2ª vez com
    `'Fornecedor reajustou'`; resolvendo com o pendente ⇒ diálogo fecha e `onDone('pending')`.
  - modo `justification` ⇒ botão "Confirmar".
  - reenvio rejeita com `ApiError(400, 'A justificativa precisa ter pelo menos 10 caracteres.')` ⇒ a mensagem
    aparece no diálogo, que continua aberto com o texto; `onDone` não chamado.
  - "Cancelar" ⇒ diálogo fecha, `action` chamada 1 vez só, `onDone` não chamado.
  - erro que não é 409 de justificativa (`ApiError(409, 'Código já usado', { errorCode: 'PRODUCT_BARCODE_TAKEN' })`)
    ⇒ `execute` rejeita com esse erro (o componente de teste mostra `e.message`), sem diálogo.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/hooks/use-approval-flow.spec.tsx`
  Expected: FAIL `Failed to resolve import "./use-approval-flow"`.

- [ ] **Step 3: Implementar** o componente e o hook conforme Interfaces (o hook guarda a ação pendente num
  `useRef` e o estado do diálogo em `useState`; `dialog` é o `<JustificationDialog …/>` já ligado).

- [ ] **Step 4: Rodar e commit**
```bash
npx vitest run src/hooks/use-approval-flow.spec.tsx
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add src/components/justification-dialog.tsx src/hooks/use-approval-flow.tsx src/hooks/use-approval-flow.spec.tsx
git commit -m "feat(web): diálogo de justificativa e fluxo de aprovação reutilizável" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 7; suíte verde; `tsc exit=0`.

---

### Task 3: Produtos e Perdas usam o fluxo

**Files:** Modify `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`, `page.spec.tsx`,
`web-panel/src/app/(protected)/losses/losses-client.tsx`, `losses-client.spec.tsx`.

**Interfaces:**
- Consumes: `useApprovalFlow` (Task 2), `api.delete(path, body)` (Task 1).

- [ ] **Step 1: Testes (vão falhar)**
  - `produtos/page.spec.tsx` (o mock de `api` já tem `patch`/`delete`):
    - "editar preço sensível pede justificativa e reenvia": `api.patch` rejeita 1× com o 409 (`mode:
      'justification'`) e depois resolve com o produto ⇒ ao salvar a edição aparece o diálogo "Justificativa";
      digitar e "Confirmar" ⇒ `api.patch` chamado 2× e a 2ª com `justification: '<texto>'` junto dos campos;
      o diálogo de edição fecha e a busca recarrega (`api.get` de `products/search` chamado de novo).
    - "cancelar a justificativa mantém a edição aberta": após o 409, "Cancelar" ⇒ o diálogo "Editar produto"
      continua visível com o nome digitado; `api.patch` chamado 1×.
    - "arquivar produto com perdas em modo aprovação": `api.delete` rejeita 1× com o 409 (`mode: 'approval'`) e
      resolve com o pendente ⇒ "Enviar para aprovação" ⇒ `api.delete` chamado com
      `('products/p-a', { justification: '<texto>' })`; aparece "Enviado para aprovação de outro gerente.".
  - `losses/losses-client.spec.tsx`:
    - "editar perda em modo aprovação mostra o aviso e fecha a edição": `api.patch` 409 (`approval`) e depois
      pendente ⇒ aviso visível; o diálogo de edição fecha.
    - "excluir perda com justificativa": `api.delete` 409 (`justification`) e depois `undefined` ⇒ `api.delete`
      2ª chamada com `('losses/l-1', { justification: '<texto>' })`; a lista recarrega.

- [ ] **Step 2: Rodar e ver falhar** —
  `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx" "src/app/(protected)/losses/losses-client.spec.tsx"`
  Expected: os testes novos FAIL (sem diálogo; mensagem do 409 no lugar do erro); os antigos PASS.

- [ ] **Step 3: Implementar** — nas duas telas: `const approval = useApprovalFlow();`, renderizar
  `{approval.dialog}` e `{approval.notice && <p role="status" …>{approval.notice}</p>}` no topo da página. Nos
  4 handlers (`handleEditSubmit` e `handleArchiveConfirmed` de produtos; `handleEditSubmit` e
  `handleDeleteConfirmed` de perdas) trocar a chamada direta por
  `await approval.execute((justification) => api.patch|delete(…, { …campos, justification }), () => { /* o que
  hoje vem depois do await: fechar diálogo e recarregar */ })`, mantendo o `catch` atual para os outros erros.
  Um aviso anterior some (`clearNotice()`) ao abrir outra edição/exclusão.

- [ ] **Step 4: Rodar e commit**
```bash
npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx" "src/app/(protected)/losses/losses-client.spec.tsx"
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add "src/app/(protected)/cadastros/produtos" "src/app/(protected)/losses"
git commit -m "feat(web): justificativa e aviso de aprovação ao editar/arquivar produto e editar/excluir perda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; suíte verde; `tsc exit=0`.

---

### Task 4: Página Aprovações (políticas + fila)

**Files:** Create `web-panel/src/app/(protected)/aprovacoes/page.tsx` (server: lê `getSessionUser()` e passa
`currentUserId`), `aprovacoes-client.tsx`, `aprovacoes-client.spec.tsx`.

**Interfaces:**
- Consumes: Task 1 (tipos, `POLICY_LABELS`, `modeDescription`, `describeRequest`); `formatDateTimeBR`.
- Produces: rota `/aprovacoes`; `AprovacoesClient({ currentUserId }: { currentUserId: string })`; dispara
  `window.dispatchEvent(new Event('approvals:changed'))` depois de cada decisão/cancelamento (o selo do menu
  escuta — Task 5).

Tela:
- **Card "Políticas de aprovação"**: `modeDescription(activeManagers)`; um `Checkbox` por política com o rótulo
  de `POLICY_LABELS`; campo numérico "Limite (%)" (min 1, max 1000) ao lado de `price_change`; "Salvar
  políticas" ⇒ `api.put('approval-policies', policies)` e mostra "Políticas salvas."; erro da API aparece no card.
- **Pedidos** com `Tabs` "Pendentes" / "Decididos" (`GET change-requests?status=pending|decided`). Cada pedido
  (`<li>` numa lista com `aria-label="Pedidos"`): `entityLabel`, `POLICY_LABELS[policy]`, linhas de
  `describeRequest`, "Pedido por <requestedByName> em <data>", "Justificativa: …", "Vence em <expiresAt>"
  (pendentes) ou status + "por <decidedByName>" + `decisionNote` (decididos).
  - Pendente de **outro** gerente: campo "Observação (opcional)" + botões "Aprovar" e "Recusar" ⇒
    `api.post('change-requests/<id>/approve'|'reject', { note })`.
  - Pendente do **próprio** gerente (`requestedByUserId === currentUserId`): só "Cancelar pedido" ⇒
    `api.post('change-requests/<id>/cancel')`.
  - Resposta com `status: 'expired'` ⇒ mensagem `decisionNote` ("O registro mudou desde o pedido.") no topo.
  - Depois de qualquer decisão: recarrega a aba atual e dispara `approvals:changed`.
  - Rótulos de status: pending "Pendente", approved "Aprovado", rejected "Recusado", expired "Expirado",
    cancelled "Cancelado".

- [ ] **Step 1: Testes (vão falhar)** — `aprovacoes-client.spec.tsx` (mock de `api` com `get`, `put`, `post`):
  - mostra o modo ("Sua empresa tem 2 gerentes ativos: …") e as 4 políticas marcadas conforme a API.
  - salvar políticas: desmarcar `loss_edit`, mudar limite para 30, "Salvar políticas" ⇒ `api.put` com
    `('approval-policies', { price_change: { enabled: true, thresholdPercent: 30 }, retro_fix: {…},
    loss_edit: { enabled: false }, archive_with_history: {…} })`; "Políticas salvas." visível.
  - lista pendente de outro gerente com "Arroz", "Preço unitário: R$ 10,00 → R$ 15,00" (regex), "Pedido por
    Ana", "Justificativa: Fornecedor reajustou"; "Aprovar" com observação "Conferi" ⇒ `api.post` com
    `('change-requests/c1/approve', { note: 'Conferi' })` e depois `api.get` da lista de novo.
  - pedido do próprio gerente: sem "Aprovar"/"Recusar"; "Cancelar pedido" ⇒ `api.post('change-requests/c1/cancel')`.
  - aprovar e receber `{ …, status: 'expired', decisionNote: 'O registro mudou desde o pedido.' }` ⇒ a nota
    aparece.
  - erro 403 `SELF_APPROVAL` ao aprovar ⇒ a mensagem da API aparece.
  - aba "Decididos" ⇒ `api.get('change-requests?status=decided')` e mostra "Recusado" e a nota.
  - dispara `approvals:changed` após decidir (espie com `window.addEventListener`).

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run "src/app/(protected)/aprovacoes/aprovacoes-client.spec.tsx"`
  Expected: FAIL `Failed to resolve import "./aprovacoes-client"`.

- [ ] **Step 3: Implementar** conforme a descrição da tela.

- [ ] **Step 4: Rodar e commit**
```bash
npx vitest run "src/app/(protected)/aprovacoes/aprovacoes-client.spec.tsx"
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add "src/app/(protected)/aprovacoes"
git commit -m "feat(web): página Aprovações (políticas e fila de pedidos)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 8; suíte verde; `tsc exit=0`.

---

### Task 5: Link no menu com selo de pendentes

**Files:** Modify `web-panel/src/components/nav.tsx`, `web-panel/src/components/nav.spec.tsx`.

**Interfaces:**
- Consumes: `api.get('change-requests/pending-count')` → `{ count }`; evento `approvals:changed` (Task 4).
- Produces: item `{ href: '/aprovacoes', label: 'Aprovações', icon: ClipboardCheck }` em `MANAGER_LINKS`, logo
  depois de "Auditoria"; selo com o número quando `count > 0` (`aria-label="<n> pedidos pendentes"`).

- [ ] **Step 1: Testes (vão falhar)** — em `nav.spec.tsx`, mockar `@/lib/api-client` (`api.get` resolvendo
  `{ count: 0 }` por padrão, para os testes antigos):
  - gerente vê o link "Aprovações" (`href="/aprovacoes"`) e, com `{ count: 3 }`, o selo "3" com
    `aria-label="3 pedidos pendentes"`; `api.get` chamado com `'change-requests/pending-count'`.
  - `count: 0` ⇒ sem selo; funcionário ⇒ sem link e `api.get` **não** chamado.
  - disparar `window.dispatchEvent(new Event('approvals:changed'))` ⇒ `api.get` chamado de novo e o selo
    atualiza para o novo número.
  - `api.get` rejeitando ⇒ link sem selo, sem quebrar.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/components/nav.spec.tsx`
  Expected: os testes novos FAIL (sem link).

- [ ] **Step 3: Implementar** — `useEffect` só para `role === 'manager'`: busca a contagem no mount, a cada
  mudança de `pathname` e no evento `approvals:changed` (remover o listener no cleanup); erro ⇒ contagem 0.

- [ ] **Step 4: Rodar e commit**
```bash
npx vitest run src/components/nav.spec.tsx
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add src/components/nav.tsx src/components/nav.spec.tsx
git commit -m "feat(web): link Aprovações no menu com selo de pedidos pendentes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; suíte verde; `tsc exit=0`.

---

### Task 6: Verificação no navegador e registro

- [ ] **Step 1: Verificar** (backend + painel rodando; banco de desenvolvimento já tem a 17000). Como gerente
  demo (atalho "Entrar como Gerente" do login), empresa com **1 gerente**:
  1. Menu → **Aprovações**: "Sua empresa tem 1 gerente ativo…"; ligar `price_change` (20%) e salvar.
  2. Produtos → editar "bolacha" de R$ 10,00 para R$ 15,00 ⇒ diálogo de justificativa; cancelar ⇒ nada muda;
     de novo com justificativa ⇒ salvo; **Histórico** do produto mostra a alteração com "Justificativa: …".
  3. Voltar o preço para R$ 10,00 (também pede justificativa) e **desligar** a política ao final (deixar o banco
     como estava).
  4. O modo aprovação (2 gerentes) é coberto pelos testes; não criar um segundo gerente no banco demo.
  5. `read_console_messages` sem erros novos; celular (`resize_window` mobile) com o diálogo de justificativa
     utilizável.

- [ ] **Step 2: Registrar** — no spec do SP2, depois do bloco "Resultado da 2.2.1": "**Resultado da 2.2.2
  (<data>):** página **Aprovações** (`/aprovacoes`: políticas com o modo atual e fila Pendentes/Decididos com
  aprovar/recusar com observação e cancelar o próprio pedido) — a configuração das políticas ficou nesta página
  porque o painel não tem página de Configurações da empresa; selo de pendentes no menu; diálogo de justificativa
  e aviso "Enviado para aprovação" em editar/arquivar produto e editar/excluir perda (`useApprovalFlow`).
  **Etapa 2.2 concluída.**" Na seção 10 do mestre, linha do SP2, o andamento e o link do plano.

- [ ] **Step 3: Checagem final e commit**
```bash
cd /c/PROJETOS/SAAS/web-panel && npm test 2>&1 | grep -E "Test Files|Tests " && npx tsc --noEmit; echo "tsc exit=$?"
cd /c/PROJETOS/SAAS && git add docs/superpowers/specs
git commit -m "docs: andamento do SP2 — sub-etapa 2.2.2" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (3.5 e testes web da 3.6):** seção "Aprovações" com as 4 políticas, limite % e o modo
atual → Task 4 (na página Aprovações — decisão registrada na Architecture e na Task 6); página Aprovações com
pendentes ("de → para", quem pediu, justificativa, prazo) e decididos, aprovar/recusar com nota → Task 4; selo
no menu → Task 5; diálogo de justificativa e aviso "Enviado para aprovação" nos pontos da 3.3 → Tasks 2 e 3
(o endpoint da correção retroativa entra na 2.3). Testes web: diálogo reenviando, aviso de pendente, página →
Tasks 2–4.

**Consistência:** `justificationRequired`/`isPendingApproval`/`PENDING_APPROVAL_NOTICE` (Task 1) usados no hook
(Task 2); `useApprovalFlow().execute/dialog/notice` (Task 2) usados na Task 3; `api.delete(path, body)` (Task 1)
na Task 3; evento `approvals:changed` produzido na Task 4 e consumido na Task 5; `describeRequest` usa
`describeChange` de `src/lib/audit.ts` (2.1.2).

# SP2 — Etapa 2.4: Motor de cadastros (blocos do painel) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair do painel os blocos que as telas de cadastro repetem (`ResourceTable`, `ResourceFormDialog`,
`ArchiveDialog`, somados ao `HistoryDrawer` e ao `JustificationDialog` já existentes), trocar Motivo da Perda e Local
da Perda para esses blocos **sem mudança visível**, exceto pelo novo botão **Histórico**, e fazer Produtos
reaproveitar o `ArchiveDialog`. Com isso as telas novas do SP4/SP5 já nascem prontas.

**Architecture:** Só painel web: nenhuma mudança no backend. O `BaseCatalogService` está adiado para o SP4 pela
regra dos três (spec 5). Os blocos ficam em `src/components/resources/`. As duas telas passam a compor um
`SimpleCatalogPage` (substituto do `CatalogManager`, que é apagado) a partir dos blocos. Antes de mexer, um conjunto
de testes de caracterização registra o comportamento atual das telas. É ele que prova o "sem mudança visível".

**Tech Stack:** Next.js 14, React 18, Tailwind 3, shadcn/radix (`Table`, `Dialog`, `Button`, `Input`, `Label`,
`Card`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md`, seção 5 (e o risco 5 do
mestre: "extrair só o que se repete").

## Global Constraints

- **Regra:** extrair só o que 3 ou mais telas repetem, sem DSL nem gerador. Cada bloco recebe dados e callbacks e não conhece o recurso.
- **Sem mudança visível** nas telas atuais. Exceção: o botão **"Histórico"** por linha em Motivos e Locais
  (`aria-label="Histórico de <nome>"`, abre o `HistoryDrawer` com `entityType` `loss_reason` / `loss_location`).
- Os textos atuais continuam idênticos:
  - título e descrição da página;
  - rótulo do campo (`Motivo` / `Local`) e placeholder "Nome do motivo" / "Nome do local";
  - botões "Cadastrar" / "Cadastrando...", "Editar", "Excluir" / "Excluindo...";
  - diálogo de edição: título "Editar motivo" / "Editar local", descrição "Altere o nome e salve.",
    botões "Salvar alterações" / "Salvando..." e "Cancelar";
  - listagem: "Carregando..." e "Nenhum motivo cadastrado ainda." / "Nenhum local cadastrado ainda.";
  - erros da API como vêm do backend; sem mensagem, `Erro ao cadastrar motivo.` etc.
- Arquivar produto mantém o texto atual:
  - título "Arquivar produto";
  - descrição "<strong>nome</strong> deixará de aparecer no app dos funcionários. O histórico de perdas
    registradas com ele é mantido, e você pode reativá-lo depois na aba Arquivados.";
  - botões "Cancelar" e "Arquivar" / "Arquivando...".
- Motivos e Locais continuam **excluindo** (sem diálogo de confirmação, como hoje). O arquivamento deles é do SP5.
- **Não entram agora** (sem tela que use hoje, YAGNI):
  - busca e paginação no `ResourceTable`: chegam quando o primeiro recurso paginado migrar (Produtos já tem a própria
    busca de servidor e não migra nesta etapa);
  - modo "reativar" do `ArchiveDialog`: entra no SP5.
- Baseline do painel: 46 arquivos / 237 testes; `npx tsc --noEmit` limpo.
- Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Nome duplicado ou motivo em uso** (o backend responde 409/400 com mensagem) ⇒ a mensagem aparece no mesmo lugar
   de antes (formulário de cadastro, diálogo de edição ou topo da lista) e a lista não é apagada. → Tasks 1 e 3.
2. **Editar e salvar sem mudar nada, ou apagando o nome** ⇒ o `required` do campo impede enviar vazio, como hoje. → Tasks 2 e 3.
3. **Clique duplo em "Salvar alterações"** ⇒ um envio só (botão desabilitado enquanto envia). → Task 2.
4. **Histórico de um motivo excluído** ⇒ o botão some junto com a linha; não há gaveta aberta apontando para linha inexistente. → Task 3.
5. **Erro ao carregar a lista** ⇒ mensagem de erro, sem ficar em "Carregando..." para sempre. → Tasks 1 e 3.

---

### Task 1: Testes de caracterização de Motivos e Locais (rede de segurança)

**Files:** Create `web-panel/src/app/(protected)/cadastros/motivos/page.spec.tsx`,
`web-panel/src/app/(protected)/cadastros/locais/page.spec.tsx`.

**Interfaces:** nenhuma nova. Os testes renderizam as **páginas** (`LossReasonsPage`, `LossLocationsPage`) e não o
`CatalogManager`, para continuarem valendo depois da troca.

- [ ] **Step 1: Escrever os testes** (mock de `@/lib/api-client` com `get`, `post`, `patch`, `delete`), em Motivos:
  - lista: `api.get('loss-reasons')` ⇒ `[{ id: 'r1', name: 'Quebra' }, { id: 'r2', name: 'Furto' }]` ⇒ as duas
    linhas aparecem; título "Motivo da Perda" e a descrição da página.
  - vazio: `[]` ⇒ "Nenhum motivo cadastrado ainda."; enquanto a promessa não resolve ⇒ "Carregando...".
  - erro ao carregar: `ApiError(500, 'Falha')` ⇒ "Falha" visível e "Carregando..." some.
  - cadastrar: digitar no campo com placeholder "Nome do motivo" e clicar "Cadastrar" ⇒ `api.post('loss-reasons',
    { name: 'Vencido' })`, o campo volta a vazio e a lista recarrega (2ª chamada de `api.get`).
  - erro ao cadastrar: `api.post` rejeita `ApiError(409, 'Já existe um motivo com esse nome.')` ⇒ mensagem visível
    e o campo mantém o texto.
  - editar: "Editar" da linha "Quebra" abre o diálogo "Editar motivo" com "Quebra" no campo; trocar para
    "Quebra/Avaria" e "Salvar alterações" ⇒ `api.patch('loss-reasons/r1', { name: 'Quebra/Avaria' })`, o diálogo
    fecha e a lista recarrega; erro no `patch` ⇒ mensagem dentro do diálogo, que continua aberto.
  - excluir: "Excluir" da linha "Quebra" ⇒ `api.delete('loss-reasons/r1')` e recarga; erro
    `ApiError(409, 'Motivo em uso.')` ⇒ mensagem visível e as linhas continuam.
  - Os botões "Editar" e "Excluir" são por linha. Use `within(screen.getByRole('row', { name: /Quebra/ }))`.
  - Em Locais, os mesmos casos essenciais com `loss-locations`, "Local da Perda", "Nome do local", "Editar local" e
    "Nenhum local cadastrado ainda." (lista, vazio, cadastrar, editar, excluir).
- [ ] **Step 2: Rodar** — `cd /c/PROJETOS/SAAS/web-panel && npx vitest run "src/app/(protected)/cadastros/motivos" "src/app/(protected)/cadastros/locais"`
  Expected: **PASS**. São testes de caracterização do comportamento **atual**; passar agora é o esperado. Se algum
  falhar, é o teste que está descrevendo errado a tela atual: ajuste o teste, nunca a tela.
- [ ] **Step 3: Checagem de sensibilidade** — trocar temporariamente, no `CatalogManager`, "Nenhum ... cadastrado
  ainda." por outro texto ⇒ o teste de vazio FAIL; desfazer.
- [ ] **Step 4: Commit**
```bash
git add "src/app/(protected)/cadastros/motivos/page.spec.tsx" "src/app/(protected)/cadastros/locais/page.spec.tsx"
git commit -m "test(web): caracterização das telas de Motivo e Local da Perda antes do motor de cadastros" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Blocos `ResourceTable`, `ResourceFormDialog` e `ArchiveDialog`

**Files:** Create em `web-panel/src/components/resources/`: `resource-table.tsx`, `resource-table.spec.tsx`,
`resource-form-dialog.tsx`, `resource-form-dialog.spec.tsx`, `archive-dialog.tsx`, `archive-dialog.spec.tsx`.

**Interfaces (Produces):**
- `interface ResourceColumn<T> { key: string; header: string; render: (row: T) => ReactNode; className?: string }`
- `ResourceTable<T extends { id: string }>({ columns, rows, loading, emptyText, actions?, actionsHeader = 'Ações' }:
  { columns: ResourceColumn<T>[]; rows: T[]; loading: boolean; emptyText: string; actions?: (row: T) => ReactNode;
  actionsHeader?: string })`. Usa `Table` do shadcn. Enquanto carrega, uma linha "Carregando..."; sem linhas, uma
  linha com `emptyText`; a coluna de ações só existe se `actions` vier (alinhada à direita, `flex justify-end
  gap-2`). É o mesmo markup e as mesmas classes da tabela do `CatalogManager` (`Card` com `overflow-hidden py-0`
  fica com quem usa).
- `interface ResourceField { name: string; label: string; required?: boolean; type?: 'text' | 'number' }`
- `ResourceFormDialog({ open, title, description, fields, initialValues, submitLabel = 'Salvar alterações',
  submittingLabel = 'Salvando...', errorFallback, onSubmit, onOpenChange }: { …; initialValues: Record<string,
  string>; errorFallback: string; onSubmit: (values: Record<string, string>) => Promise<void>; onOpenChange: (open:
  boolean) => void })`:
  - reinicia os valores a cada abertura;
  - enquanto envia, desabilita o botão;
  - sucesso ⇒ `onOpenChange(false)`;
  - erro ⇒ `ApiError.message` (ou `errorFallback`) dentro do diálogo, que continua aberto;
  - "Cancelar" ⇒ `onOpenChange(false)`.
- `ArchiveDialog({ open, title, description, confirmLabel = 'Arquivar', confirmingLabel = 'Arquivando...', confirming,
  onConfirm, onOpenChange }: { open: boolean; title: string; description: ReactNode; confirming: boolean; onConfirm:
  () => void; onOpenChange: (open: boolean) => void; confirmLabel?: string; confirmingLabel?: string })`:
  - botão de confirmar `variant="destructive"`;
  - "Cancelar" `variant="outline"`;
  - os dois ficam desabilitados enquanto `confirming`.

- [ ] **Step 1: Testes (vão falhar)**:
  - `resource-table.spec.tsx`:
    - "Carregando..." com `loading`;
    - `emptyText` com `rows: []`;
    - uma linha por item, com o `render` de cada coluna;
    - cabeçalho "Ações" e o conteúdo de `actions(row)` só quando `actions` vem;
    - sem `actions`, não há coluna "Ações".
  - `resource-form-dialog.spec.tsx`:
    - abre com `initialValues` no campo `label`;
    - editar e "Salvar alterações" ⇒ `onSubmit({ name: 'Novo' })` e depois `onOpenChange(false)`;
    - clique duplo com `onSubmit` pendente ⇒ `onSubmit` chamado 1 vez e botão "Salvando..." desabilitado;
    - `onSubmit` rejeitando `ApiError(409, 'Já existe.')` ⇒ mensagem no diálogo e `onOpenChange` não chamado;
    - rejeição genérica ⇒ `errorFallback`;
    - campo `required` vazio ⇒ `onSubmit` não chamado;
    - reabrir com outro `initialValues` ⇒ campo com o valor novo.
  - `archive-dialog.spec.tsx`:
    - título e `description` (ReactNode) visíveis;
    - "Arquivar" ⇒ `onConfirm`;
    - "Cancelar" ⇒ `onOpenChange(false)`;
    - `confirming` ⇒ "Arquivando..." e os dois botões desabilitados.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/components/resources`
  Expected: FAIL `Failed to resolve import`.
- [ ] **Step 3: Implementar** os três blocos conforme as Interfaces.
- [ ] **Step 4: Rodar e commit** — PASS; `npm test` verde; `npx tsc --noEmit` exit 0.
```bash
git add src/components/resources
git commit -m "feat(web): blocos do motor de cadastros (ResourceTable, ResourceFormDialog, ArchiveDialog)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Motivos e Locais nos blocos (+ Histórico) e remoção do `CatalogManager`

**Files:** Create `web-panel/src/components/resources/simple-catalog-page.tsx`; Modify
`web-panel/src/app/(protected)/cadastros/motivos/page.tsx`, `…/locais/page.tsx` e os dois `page.spec.tsx` (novos
casos do Histórico); Delete `web-panel/src/components/catalog-manager.tsx`.

**Interfaces:**
- Consumes: Task 2 (`ResourceTable`, `ResourceFormDialog`); `HistoryDrawer` (`src/components/history-drawer.tsx`:
  `{ entityType, entityId, title, open, onOpenChange }`).
- Produces: `SimpleCatalogPage({ resource, auditEntityType, title, description, itemLabel }: { resource:
  'loss-reasons' | 'loss-locations'; auditEntityType: 'loss_reason' | 'loss_location'; title: string; description:
  string; itemLabel: string })`. Tem os mesmos props do `CatalogManager` mais `auditEntityType`.
  - O cabeçalho e o card de cadastro inline seguem iguais: o formulário de cadastro continua na página, não é diálogo.
  - A lista é um `ResourceTable` com a coluna do `itemLabel` (`font-medium`).
  - As ações da linha são "Histórico" (novo, `variant="outline"` `size="sm"`, ícone `History`,
    `aria-label="Histórico de <nome>"`), "Editar" e "Excluir", como hoje.
  - A edição usa o `ResourceFormDialog` com o campo `name`.
  - O Histórico abre o `HistoryDrawer` com o `auditEntityType`, o `id` e o nome da linha.

- [ ] **Step 1: Testes novos (vão falhar)** — nos dois `page.spec.tsx`:
  - "Histórico de Quebra" abre a gaveta "Histórico — Quebra" e chama
    `api.get('audit?entityType=loss_reason&entityId=r1&pageSize=100')`. Em Locais, com `loss_location`.
  - Depois de excluir a linha (a recarga devolve lista sem ela), o botão "Histórico de Quebra" some.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run "src/app/(protected)/cadastros/motivos" "src/app/(protected)/cadastros/locais"`
  Expected: os casos novos FAIL (botão inexistente); os de caracterização continuam PASS.
- [ ] **Step 3: Implementar** o `SimpleCatalogPage`; trocar as duas páginas para ele (mesmos textos de hoje mais
  `auditEntityType`); apagar `catalog-manager.tsx` e conferir que nada mais o importa
  (`grep -rn "catalog-manager" src` sem resultado).
- [ ] **Step 4: Rodar e commit** — os testes de caracterização da Task 1 continuam **sem nenhuma mudança** e PASS
  (é a prova do "sem mudança visível"); `npm test` verde; `tsc` exit 0.
```bash
git add src/components/resources "src/app/(protected)/cadastros/motivos" "src/app/(protected)/cadastros/locais" src/components/catalog-manager.tsx
git commit -m "feat(web): Motivo e Local da Perda nos blocos do motor, com Histórico; remove CatalogManager" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Produtos usa o `ArchiveDialog`

**Files:** Modify `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`.

**Interfaces:** Consumes `ArchiveDialog` (Task 2).

- [ ] **Step 1: Trocar** o `Dialog` de arquivar produto pelo `ArchiveDialog`, com os textos de hoje (Global
  Constraints), `confirming={archiving}` e `onConfirm={handleArchiveConfirmed}`.
- [ ] **Step 2: Rodar** — `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx"`.
  Expected: PASS **sem mudar os testes**. O teste "\"Excluir\" virou \"Arquivar\"…" já confere os três trechos do
  texto e o botão, e o teste de arquivar com justificativa (2.2.2) confere o fluxo. Se algum falhar, a troca mudou
  algo visível: corrigir o código, não o teste.
- [ ] **Step 3: Commit** — `npm test` verde; `tsc` exit 0.
```bash
git add "src/app/(protected)/cadastros/produtos/page.tsx"
git commit -m "refactor(web): arquivar produto usa o ArchiveDialog do motor de cadastros" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação no navegador e registro

- [ ] **Step 1: Verificar** (painel e backend no ar, gerente demo):
  - Motivo da Perda: a tela está igual a antes, com o botão "Histórico" a mais. Abrir o Histórico de um motivo mostra
    a criação (ou "Nenhuma alteração registrada." para motivos anteriores à auditoria).
  - Cadastrar "Teste 2.4", editar para "Teste 2.4 editado" e excluir. Isso deixa o banco como estava, e o Histórico
    do item mostra criação e alteração antes da exclusão.
  - Local da Perda: abrir o Histórico de um local.
  - Produtos: "Arquivar" abre o diálogo com o texto de sempre. Cancelar, para não mexer no demo.
  - Conferir o console (`read_console_messages`) sem erros novos.
- [ ] **Step 2: Registrar**
  - No spec do SP2, fim da seção 5: "**Resultado da 2.4 (<data>):** blocos `ResourceTable`, `ResourceFormDialog` e
    `ArchiveDialog` em `web-panel/src/components/resources/` (mais `HistoryDrawer` e `JustificationDialog`); Motivo e
    Local da Perda compõem o `SimpleCatalogPage`, sem mudança visível, provada por testes de caracterização escritos
    antes da troca, e com o botão Histórico; Produtos usa o `ArchiveDialog`; `CatalogManager` removido. Busca e
    paginação no `ResourceTable` e o modo reativar do `ArchiveDialog` ficam para quando uma tela precisar (SP4/SP5).
    **SP2 concluído.**"
  - Na seção 10 do mestre, linha do SP2: "SP2 CONCLUÍDO" e o link do plano.
- [ ] **Step 3: Commit**
```bash
cd /c/PROJETOS/SAAS/web-panel && npm test 2>&1 | grep -E "Test Files|Tests " && npx tsc --noEmit; echo "tsc exit=$?"
cd /c/PROJETOS/SAAS && git add docs/superpowers/specs
git commit -m "docs: andamento do SP2 — etapa 2.4 e SP2 concluído" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (seção 5):**
- `ResourceTable`, `ResourceFormDialog` e `ArchiveDialog` → Task 2.
- `HistoryDrawer` e `JustificationDialog` já existem (2.1.2 e 2.2.2) e são consumidos como estão.
- Motivos e Locais nos blocos, sem mudança visível e com Histórico → Tasks 1 e 3.
- Produtos reaproveita `HistoryDrawer` (já), `JustificationDialog` (já, pela 2.2.2) e `ArchiveDialog` → Task 4.
- `CatalogManager` removido → Task 3.
- `BaseCatalogService` adiado para o SP4, sem task, por decisão do spec.
- Testes: cada bloco com vitest → Task 2; testes de comportamento das telas mantidos verdes → Tasks 1 e 3. Hoje não
  há testes dessas telas, por isso a Task 1 os escreve antes da troca.

**Desvios conscientes do texto do spec:** busca e paginação do `ResourceTable` ficam de fora. Nenhuma tela que migra
agora as usa, e habilitá-las em Motivos/Locais seria mudança visível. Mesma lógica para o modo reativar do
`ArchiveDialog`, que nenhuma tela usa com diálogo hoje.

**Consistência:** `ResourceTable`/`ResourceFormDialog` (Task 2) são consumidos com as mesmas props na Task 3.
`ArchiveDialog` (Task 2) é usado na Task 4. `SimpleCatalogPage` recebe os props do `CatalogManager` mais
`auditEntityType`.

# SP2 — Auditoria, aprovações e motor de cadastros (desenho detalhado)

Data: 2026-09-24
Status: **Rascunho para revisão do usuário — nada implementado.**
Pai: [Cadastros 2.0 — desenho mestre](2026-09-20-cadastros-2-0-design-mestre.md) (seção 5, SP2).
Base: [SP1 — Fundação de dados](2026-09-20-sp1-fundacao-de-dados-design.md) (concluído em 2026-09-24).

## 0. Objetivo, escopo e o que o usuário decidiu

**Objetivo (mestre):** saber quem mudou o quê, permitir dupla checagem em mudanças sensíveis e parar de
reescrever a mesma tela de cadastro.

**Decisões do usuário no levantamento (2026-09-24):**

| # | Pergunta | Resposta |
|---|---|---|
| U1 | Quantos gerentes por empresa? | Varia por empresa; pode haver mais de 2 ⇒ aprovação **configurável**, com modo automático por número de gerentes (seção 3). |
| U2 | Que mudanças podem exigir aprovação/justificativa? | As quatro: **preço/custo acima de X%**, **correção retroativa de preço**, **editar/excluir perda já registrada**, **arquivar cadastro com histórico**. |
| U3 | O que auditar além de produtos, motivos, locais e perdas? | Tudo: **usuários**, **configurações da empresa**, **importações**, **logins**. |
| U4 | Como gravar a auditoria? | **Trigger no banco + eventos explícitos** (substitui A7 do mestre — seção 2.1). |
| U5 | Divisão em etapas, fora de escopo e padrões (seção 1) | Aprovados. |

**Fora de escopo do SP2:** "Desfazer" a partir do log; particionamento mensal da auditoria; aviso por
e-mail (D3); papel "auditor" (SP7 — até lá, auditoria é só do gerente); políticas de aprovação para edição
em massa e mescla de produtos (nascem com essas funções no SP4); aprovação sobre importação (SP3);
arquivamento de motivo/local (SP5 — hoje eles só se excluem, e a exclusão é recusada se houver perda);
`BaseCatalogService` no backend (seção 5 — adiado para o SP4 pela regra dos três).

**Padrões adotados (aprovados em U5):** retenção configurada em 24 meses (nada é apagado no SP2);
limite de variação de preço/custo 20%; pedido de aprovação expira em 7 dias.

## 1. Etapas e ordem

| Etapa | Entrega | Depende de |
|---|---|---|
| **2.1** | Auditoria: tabela, trigger, eventos, página Auditoria, gaveta Histórico | SP1 |
| **2.2** | Justificativa e aprovações (políticas por empresa, fila, página Aprovações) | 2.1 |
| **2.3** | Correção retroativa de preço | 2.1, 2.2 |
| **2.4** | Motor de cadastros (blocos web; Motivos/Locais migram sem mudança visível) | 2.1 |

Cada etapa ganha seu próprio plano (e pode ser dividida em backend/web, como a 1.3 e a 1.4). Ordem
obrigatória: 2.1 → 2.2 → 2.3; a 2.4 pode vir depois da 2.1 em qualquer ponto (padrão: por último).

---

## 2. Etapa 2.1 — Trilha de auditoria

### 2.1 Por que trigger (U4) e não só registro explícito

O mestre (A7) previa `AuditService.record(...)` em cada serviço porque o worker de importação "não tem
contexto de tenant". O SP1 mostrou que variáveis de sessão (`app.current_user_id`, `app.change_source`)
funcionam no middleware **e** no worker (histórico de preço por trigger — R2). Um trigger elimina a classe
inteira de bug "esqueci de auditar" (painel, app, importação, ERP futuro, qualquer `UPDATE`). O registro
explícito continua para o que **não é mudança de linha**: login, resumo de importação, decisões de aprovação,
correção retroativa.

### 2.2 Tabela `audit_log`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `seq` | bigint identity | ordem estável (desempate de `createdAt`) |
| `companyId` | uuid NOT NULL → companies ON DELETE CASCADE | RLS |
| `actorUserId` | uuid NULL → users ON DELETE SET NULL | quem fez (NULL = sistema) |
| `actorName` | varchar(150) NULL | *snapshot* do nome no momento (nomes mudam; LGPD: anonimizar troca o nome no usuário, o log mantém o snapshot — anonimização do log fica para quando houver pedido) |
| `actorRole` | varchar(20) NULL | *snapshot* do papel |
| `entityType` | varchar(40) NOT NULL | `product`, `loss_reason`, `loss_location`, `loss`, `user`, `company`, `company_revenue`, `import_job`, `session`, `change_request` |
| `entityId` | uuid NULL | |
| `action` | varchar(20) NOT NULL + CHECK | `create`, `update`, `archive`, `restore`, `delete`, `import`, `login`, `login_failed`, `approve`, `reject`, `retro_fix`, `request` (pedido de aprovação criado), `justify` |
| `changes` | jsonb NOT NULL DEFAULT '[]' | `[{field, from, to}]` (em `create`: só `to`; em `delete`: só `from`) |
| `summary` | jsonb NULL | dados agregados (importação, correção retroativa) |
| `source` | varchar(20) NOT NULL + CHECK | `web`, `mobile`, `import`, `system` (`erp` entra no SP9) |
| `reason` | text NULL | justificativa (seção 3) |
| `requestId` | uuid NULL | liga o log a uma requisição (suporte) |
| `ip` | inet NULL | |
| `createdAt` | timestamptz NOT NULL DEFAULT clock_timestamp() | |

- Índices: `(companyId, createdAt DESC, seq DESC)` (página Auditoria) e `(companyId, entityType, entityId,
  createdAt DESC)` (gaveta Histórico).
- **RLS no molde do SP1:** `ENABLE` + `FORCE` + política com `TENANT_COMPANY_ID_PREDICATE`
  (`src/database/helpers/rls.ts`).
- **Append-only de verdade:** `GRANT SELECT, INSERT` ao `inventory_saas_app` e `REVOKE UPDATE, DELETE`
  (os privilégios padrão do banco dão CRUD — é preciso revogar explicitamente). Teste: o role de runtime não
  consegue `UPDATE`/`DELETE` nem na própria empresa.
- Exclusão de empresa (Painel Master) apaga o log em cascata pela FK (como no histórico de preço — teste).

### 2.3 Trigger genérico `audit_row_change()`

Instalado **AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW** em: `products`, `loss_reasons`,
`loss_locations`, `losses`, `users`, `companies`, `company_monthly_revenue`.

- `entityType` vem de `TG_ARGV[0]`; colunas ignoradas vêm de `TG_ARGV[1]` (lista separada por vírgula),
  mais as sempre ignoradas: `updatedAt`, `createdAt`.
- **Diff:** `jsonb_each(to_jsonb(NEW))` × `to_jsonb(OLD)` com `IS DISTINCT FROM`; `UPDATE` sem nenhum campo
  relevante mudado **não grava** (ex.: só `updatedAt`).
- **Campos mascarados:** `passwordHash` (e qualquer coluna futura de PIN) aparece como
  `{field:'password', from:null, to:'alterada'}` — nunca o valor.
- **Ação:** `INSERT` ⇒ `create`; `DELETE` ⇒ `delete`; `UPDATE` com `isActive` true→false ⇒ `archive`,
  false→true ⇒ `restore` (demais campos mudados na mesma linha entram em `changes`); senão `update`.
- **Empresa:** `NEW."companyId"`/`OLD."companyId"`; em `companies`, o próprio `id`. Linha sem empresa
  (usuário `master_admin`) **não é auditada** no SP2.
- **Contexto (variáveis de sessão):** `app.current_user_id` (já existe) ⇒ `actorUserId`, e o trigger busca
  `name`/`role` em `users` (RLS: usuário de outra empresa ou inexistente ⇒ ator NULL, como no histórico de
  preço); `app.change_source` ⇒ `source` (padrão `system`); `app.request_id` ⇒ `requestId`; `app.client_ip`
  ⇒ `ip`; `app.audit_reason` ⇒ `reason` (seção 3).
- **Modo resumo:** com `app.audit_mode = 'summary'` o trigger não grava nada (a operação grava um evento
  explícito com `summary`). Usado pela importação e pela correção retroativa.
- `SECURITY INVOKER` (padrão) e `SET search_path = public, pg_temp`, como os triggers da 1.2.3.
- Colunas ignoradas por tabela (mínimo inicial): `products`: `sourceColumnMapping`; `losses`: nenhuma;
  `users`: `tokenVersion` quando existir (SP7); `companies`: `billingProviderCustomerId` e
  `currentPeriodEnd` (sincronizados pelo webhook do provedor de pagamento, que já tem trilha própria).
  `status` e `planTier` **são** auditados — bloquear/ativar uma empresa é justamente o que se quer rastrear
  (vindo do webhook, sem usuário, aparece com `source = system`).

### 2.4 Middleware e worker

- `TenantContextMiddleware` passa a definir também: `app.change_source` = `mobile` quando o `User-Agent`
  começa com `Dart/` (cliente HTTP do app Flutter) e `web` caso contrário; `app.request_id` = UUID novo por
  requisição (devolvido no cabeçalho `X-Request-Id`); `app.client_ip` = `req.ip`.
- Worker de importação: já define `app.change_source='import'`; passa a definir `app.audit_mode='summary'` e,
  ao terminar, grava **um** evento `import` (entidade `import_job`) com `summary = {totalRows, created,
  updated, reactivated, errors}`. As mudanças de preço/custo da importação continuam uma a uma no
  `product_price_history` (source `import`).

### 2.5 Eventos explícitos — `AuditService`

`AuditService.record(manager, { companyId, entityType, entityId, action, changes?, summary?, reason? })`
lê ator/origem/requestId/IP das mesmas variáveis de sessão. Usado em:
- **Login:** sucesso ⇒ `login` (ator = o próprio usuário); falha por senha errada de um e-mail existente ⇒
  `login_failed` (entidade `session`, `entityId` = id do usuário; e-mail inexistente não tem empresa ⇒ não
  registra). O login roda sem contexto de tenant: o `AuthService` grava dentro de uma transação que define
  `app.current_company_id` da empresa do usuário (o mesmo padrão de `CompaniesService.create`).
- **Importação** (acima), **aprovações** (seção 3) e **correção retroativa** (seção 4).

### 2.6 API e telas

- `GET /audit?entityType=&entityId=&actorUserId=&action=&from=&to=&page=&pageSize=` (gerente) →
  `{ items, total, page, pageSize }`, mais recente primeiro; DTO estrito como o `SearchProductsDto`.
- `GET /audit/export?…mesmos filtros…` (gerente) → CSV (UTF-8 com BOM, `;` como separador — abre direto no
  Excel em pt-BR); limite de 50 mil linhas por exportação (acima disso, pede para filtrar).
- **Página Auditoria** (menu, só gerente): tabela com data/hora, pessoa, origem, ação, entidade (com nome
  legível), alterações (resumo "Preço: R$ 10,00 → R$ 12,00"); filtros; exportar CSV.
- **Gaveta "Histórico"** (componente `HistoryDrawer`, reaproveitado na 2.4): no diálogo de edição de
  produto (ao lado da linha do tempo de preços), na linha da perda (Perdas) e na tela de Usuários.
- Tradução de campos para rótulos (`unitPrice` ⇒ "Preço unitário") num mapa único no painel.

### 2.7 Testes (TDD)

Integração (Postgres real): cada tabela auditada gera `create`/`update`/`archive`/`restore`/`delete` com o
diff certo; `UPDATE` só de `updatedAt` não grava; senha aparece como "alterada"; ator/origem/requestId/IP
vêm das variáveis de sessão; usuário inexistente ⇒ ator NULL; modo resumo não grava; RLS isola empresas;
append-only (role de runtime não faz `UPDATE`/`DELETE`); exclusão de empresa em cascata; `GET /audit` com
filtros/paginação e 400 em query inválida; CSV. Unitários: `AuditService`, mapa de rótulos (web), página e
gaveta (vitest). HTTP (app Nest real): `X-Request-Id`, `source` mobile × web pelo `User-Agent`.

**Divisão da etapa (2026-09-24):** 2.1.1 = backend; 2.1.2 = web (página Auditoria + gaveta Histórico).
**Resultado da 2.1.1 (2026-09-24):** migrations `1700000015000-AuditLog` (tabela append-only com RLS e
`audit_insert`) e `1700000016000-AuditTriggers` (trigger nas 7 tabelas); middleware define `app.audit_source`
(web/mobile pelo User-Agent), `app.request_id` (+ cabeçalho `X-Request-Id`) e `app.client_ip`; eventos de
login/falha e resumo de importação; `GET /audit` e `/audit/export` (CSV). **Decisões da execução:** variável
`app.audit_source` própria (a `app.change_source` é do histórico de preço); `audit_insert` grava com a
empresa da linha mesmo fora de contexto de tenant; empresa inexistente não audita (exclusão em cascata);
coluna `entityLabel`; falha ao auditar login não derruba o login. **Achado fora do escopo:** num banco cujo
dono das tabelas não é superusuário (o harness de testes imita esse cenário), `auth_lookup_user_by_email`
não enxerga usuários com empresa (FORCE RLS em `users`) — o login quebraria; no desenvolvimento funciona
porque o dono é `postgres`. Não corrigido aqui; aguarda decisão do usuário.
**Revisão final da 2.1.1:** 0 críticos; 3 importantes corrigidos com TDD — CSV neutraliza fórmulas (`=`, `+`,
`-`, `@`), datas ISO que o `Date` não entende dão 400 (não 500), e ações do Painel Master (criar, editar,
bloquear, renovar, desbloquear) passam a gravar autor/origem/requestId/IP (`applyRequestAuditContext`). 11
menores registrados para as próximas etapas: contadores da importação incrementados antes do save; login
com empresa bloqueada não gera evento; `login_failed` com ator = dono da conta; sem limite de tentativas;
`trust proxy`/`isIP` no `auth.controller`; CSV em UTC; `to` só com data exclui o dia; expor `X-Request-Id`
no CORS (2.1.2); faltam testes de cascata com perdas, unitário do `AuditService` e `from > to`; formato
de `changes` em create/delete leva `from: null`/`to: null`.
**Resultado da 2.1.2 (2026-09-24):** página **Auditoria** (`/auditoria`, menu do gerente: filtros de entidade,
ação e período — o período cobre dias inteiros no fuso do navegador —, paginação de 50, exportar CSV) e
gaveta **Histórico** (`HistoryDrawer`, busca sozinha `GET /audit?entityType=&entityId=`, 100 mais recentes)
em Produtos (diálogo de edição), Perdas (linha) e Usuários (linha). Rótulos e formatação num mapa único
(`web-panel/src/lib/audit.ts`). Sem mudança no backend. Verificada no navegador (desktop e celular) com os
dados reais do banco de desenvolvimento. **Etapa 2.1 concluída.**

**Pronto quando:** toda mudança em produto, motivo, local, perda, usuário, empresa e faturamento aparece no
Histórico e na página Auditoria com quem/quando/o quê/de onde; logins e importações aparecem como eventos;
ninguém consegue alterar ou apagar uma linha do log pela aplicação.

---

## 3. Etapa 2.2 — Justificativa e aprovações

### 3.1 Políticas (por empresa)

Coluna nova `companies.approvalPolicies jsonb NOT NULL DEFAULT '{}'`, editada em Configurações da empresa
(a mudança é auditada pelo trigger de `companies`):

| Chave | Gatilho | Parâmetro |
|---|---|---|
| `price_change` | edição manual de produto que muda `unitPrice` ou `costPrice` em mais de X% (só quando o valor anterior é > 0 — preencher um preço zerado não é sensível) | `thresholdPercent` (padrão 20) |
| `retro_fix` | correção retroativa de preço (seção 4) | — |
| `loss_edit` | editar ou excluir perda já registrada | — |
| `archive_with_history` | arquivar produto que já tem perdas (motivos/locais entram quando o SP5 criar o arquivamento deles) | — |

Todas **desligadas** por padrão (nada muda para quem não ativar). Importação não passa por política no SP2
(SP3).

### 3.2 Modo automático (U1)

Com uma política ligada, o modo é decidido na hora pelo número de **gerentes ativos** da empresa:
- **≥ 2 gerentes ⇒ aprovação:** a mudança não é aplicada; vira um pedido pendente que **outro** gerente
  aprova ou recusa.
- **1 gerente ⇒ justificativa:** a mudança é aplicada na hora, mas só com uma justificativa escrita, que vai
  para o `reason` da linha de auditoria (e um evento `justify`).

### 3.3 Contrato HTTP

- Sem justificativa num caso que exige: `409 { errorCode: 'JUSTIFICATION_REQUIRED', policy }` — o painel
  abre um diálogo pedindo o texto e reenvia a mesma requisição com o campo `justification` (mín. 10
  caracteres). Com justificativa, o backend define `app.audit_reason` antes de gravar.
- Caso de aprovação: `202 { status: 'pending', changeRequestId, policy }` — nada é gravado na entidade; o
  painel mostra "Enviado para aprovação". O campo `justification` é obrigatório também aqui (vira o motivo do
  pedido).
- Os endpoints afetados aceitam `justification` como campo opcional aditivo: `PATCH /products/:id`,
  `DELETE /products/:id`, `PATCH /losses/:id`, `DELETE /losses/:id`, e o endpoint da correção retroativa.

### 3.4 Tabela `change_requests`

`id`, `companyId`, `policy`, `entityType`, `entityId`, `payload jsonb` (a operação a aplicar), `snapshot
jsonb` (valores atuais no momento do pedido — para exibir "de → para" e detectar conflito), `justification`,
`status` (`pending|approved|rejected|expired|cancelled`), `requestedByUserId`, `decidedByUserId`,
`decidedAt`, `decisionNote`, `expiresAt` (criação + 7 dias), `createdAt`. RLS no molde do SP1 (o app pode
atualizar o status). Índice `(companyId, status, createdAt DESC)`.

Regras:
- Quem pediu **não** aprova nem recusa o próprio pedido (403); pode **cancelar** enquanto pendente.
- Aprovar reaplica o `payload` pelo **mesmo método de serviço** (mesmas validações), com a política
  dispensada; se a entidade mudou desde o pedido (campos do `snapshot` diferentes do atual) ⇒ não aplica,
  marca `expired` com nota "o registro mudou desde o pedido" (evita aplicar sobre dado desatualizado).
- Expiração preguiçosa: pedido `pending` com `expiresAt` passado vira `expired` ao ser listado ou decidido
  (sem job agendado).
- Um pedido pendente por entidade+política: pedir de novo substitui (cancela) o anterior.
- Auditoria: `request` na criação, `approve`/`reject` na decisão (com `decisionNote`), e a mudança aplicada
  aparece pelo trigger com `reason` = a justificativa original.

### 3.5 Telas

- **Configurações da empresa:** seção "Aprovações" com as 4 políticas (liga/desliga + limite %), mostrando
  o modo atual ("Sua empresa tem 1 gerente: as mudanças sensíveis pedirão justificativa").
- **Página Aprovações** (gerente): pendentes (com "de → para", quem pediu, justificativa, prazo) e
  decididos; aprovar/recusar com nota; selo com a contagem de pendentes no menu.
- Diálogos de justificativa e aviso "Enviado para aprovação" nos pontos da 3.3.

### 3.6 Testes

Unitários: detecção de sensibilidade (limite %, valor anterior 0, bordas), escolha do modo (0/1/2+
gerentes ativos; gerente inativo não conta). Integração: 409 sem justificativa, 202 com pedido, aprovação
aplica, autoaprovação bloqueada, recusa, cancelamento, expiração preguiçosa, conflito por registro alterado,
auditoria de cada passo, RLS. Web: diálogo de justificativa reenviando, aviso de pendente, página
Aprovações.

**Divisão da etapa (2026-09-25):** 2.2.1 = backend; 2.2.2 = web (Configurações › Aprovações, página
Aprovações com selo no menu, diálogos de justificativa e "Enviado para aprovação").
**Resultado da 2.2.1 (2026-09-25):** migration `1700000017000-ApprovalRequests` (`companies.approvalPolicies`,
`change_requests` com RLS, sem DELETE para o app, um pendente por entidade+política); regras puras
(`approval-policies.ts`, limite em centavos inteiros); portão `approval-gate.ts` em `PATCH/DELETE
/products/:id` e `PATCH/DELETE /losses/:id` (409 `JUSTIFICATION_REQUIRED` com `mode`, 202 pendente);
`GET /change-requests`, `/pending-count`, `POST /:id/approve|reject|cancel`; `GET/PUT /approval-policies`.
**Decisões da execução:** colunas `operation` e `entityLabel` em `change_requests`; o 409 informa também o
`mode`; aprovação sobre registro alterado devolve 200 com o pedido `expired` (lançar erro desfaria a marcação);
reaplicação que falha devolve o erro e mantém o pedido pendente; cancelar é só de quem pediu; políticas em
`/approval-policies` (fora de `companies/me/settings`); histórico de preço aprovado sai com origem `approval`.

**Resultado da 2.2.2 (2026-09-25):** página **Aprovações** (`/aprovacoes`: políticas com o modo atual e fila
Pendentes/Decididos com aprovar/recusar com observação e cancelar o próprio pedido) — a configuração das políticas
ficou nesta página porque o painel não tem página de Configurações da empresa; selo de pendentes no menu; diálogo
de justificativa e aviso "Enviado para aprovação" em editar/arquivar produto e editar/excluir perda
(`useApprovalFlow`). Verificada no navegador com o banco de desenvolvimento (política ligada, edição de preço
pedindo justificativa, auditoria com o motivo; banco devolvido ao estado anterior). **Etapa 2.2 concluída.**

**Pronto quando:** com a política ligada, mudar custo > 20% numa empresa com 2 gerentes cai na fila e só
é aplicado quando o outro gerente aprova; numa empresa com 1 gerente, exige justificativa, que aparece no
Histórico.

---

## 4. Etapa 2.3 — Correção retroativa de preço

**Problema:** "digitei R$ 1,20 em vez de R$ 12,00" — com o valor congelado do SP1, as perdas registradas no
período ficam para sempre com o preço errado.

- `GET /products/:id/retro-fix/preview?from=&to=&unitPrice=&costPrice=` (gerente) → `{ affectedLosses,
  currentTotal, newTotal, currentCostTotal, newCostTotal }` para o painel mostrar o impacto antes de
  confirmar.
- `POST /products/:id/retro-fix { from, to?, unitPrice, costPrice, justification }` (gerente): para as perdas
  do produto com `occurredAt` em `[from, to ?? agora]`, grava `unitPriceAtLoss`/`unitCostAtLoss` com os
  valores informados e `valuationSource = 'recalculated'`. Justificativa obrigatória sempre (mín. 10
  caracteres). Com a política `retro_fix` ligada e ≥ 2 gerentes ⇒ vira pedido de aprovação (seção 3).
- Roda em modo resumo (`app.audit_mode='summary'`) e grava **um** evento `retro_fix` no produto com
  `summary` (janela, valores novos, quantidade de perdas, total antes/depois) e `reason`.
- **Não** altera o `product_price_history` (append-only e não editável retroativamente — decisão do SP1);
  o preço atual do produto se corrige pela edição normal.
- Janela máxima: 366 dias por operação (limita o tamanho da transação); `from` não pode ser futuro.
- Painel: ação "Corrigir valores de perdas passadas" no diálogo de edição do produto, com prévia do impacto.

**Testes:** prévia bate com o aplicado; só perdas do produto e da janela; `valuationSource`; um único evento
de auditoria com o resumo; justificativa obrigatória; política/aprovação; relatórios do dashboard refletem o
valor novo; RLS.

**Resultado da 2.3 (2026-09-25):** `GET /products/:id/retro-fix/preview` e `POST /products/:id/retro-fix`
(janela até 366 dias, `from` não futuro, justificativa sempre obrigatória, `valuationSource = 'recalculated'`,
modo resumo com um único evento `retro_fix` no produto e `reason`; histórico de preço e preço atual intocados);
portão `retro_fix` (2+ gerentes ⇒ pedido; aprovação reaplica e expira se a janela mudou — perda nova ou valor
diferente); diálogo "Corrigir valores de perdas passadas" na edição do produto com prévia obrigatória (mudar
datas/valores invalida a prévia). Verificada no navegador com o banco de desenvolvimento (correção com os mesmos
valores: só a origem passou a `recalculated`). Sem migration. Revisão final: "Até" no futuro é limitado a agora; o
diálogo descarta prévia atrasada. **Limitação conhecida:** perda registrada ou editada depois, dentro de uma janela já
corrigida, volta a pegar o preço do histórico (que continua com o valor errado do período, por ser append-only).

**Pronto quando:** o gerente corrige o valor das perdas de um período com prévia do impacto, justificativa
e (se a política pedir) aprovação, e o dashboard passa a mostrar o valor corrigido, com a correção
registrada na auditoria.

---

## 5. Etapa 2.4 — Motor de cadastros (blocos, não gerador)

**Regra do mestre:** extrair só o que 3+ telas repetem; nada de DSL.

- **Web:** `ResourceTable` (lista com busca/paginação — no servidor quando o recurso tiver endpoint
  paginado), `ResourceFormDialog` (criar/editar com validação), `ArchiveDialog` (texto padrão de
  arquivar/reativar), `HistoryDrawer` (da 2.1) e `JustificationDialog` (da 2.2). Motivos e Locais passam a
  usar os blocos **sem mudança visível**, exceto pelo botão "Histórico"; Produtos reaproveita
  `HistoryDrawer`, `ArchiveDialog` e `JustificationDialog`. `CatalogManager` é removido quando nada mais o
  usar.
- **Backend: `BaseCatalogService` adiado para o SP4.** Hoje só há dois catálogos simples (motivos e locais —
  68 linhas cada, praticamente iguais); o mestre justificou a abstração com cinco (categorias, marcas,
  fornecedores chegam no SP4). Extrair com dois viola a regra dos três e arrisca a superabstração (risco 5 do
  mestre). No SP2 os dois serviços só ganham o que a auditoria/aprovação pedirem.
- **Testes:** cada bloco com vitest; as telas de Motivos/Locais mantêm os testes de comportamento atuais
  verdes (prova de "sem mudança visível").

**Pronto quando:** Motivos e Locais usam os blocos com o mesmo comportamento de antes e ganharam o
Histórico; os blocos estão prontos para as telas novas do SP4/SP5.

---

## 6. Riscos e mitigação

| ID | Risco | Mitigação |
|---|---|---|
| RS1 | Volume da auditoria (uma linha por perda registrada pelo app) | Índices da 2.2; retenção configurada; particionamento só se o volume pedir |
| RS2 | Trigger lento em escrita em massa | Modo resumo para importação e correção retroativa; o trigger só faz um diff de colunas da própria linha |
| RS3 | Dado sensível no log | Máscara de senha/PIN no próprio trigger; colunas de cobrança ignoradas; teste que falha se `passwordHash` aparecer |
| RS4 | Empresa travada por aprovação (1 gerente) | Modo automático: com 1 gerente vira justificativa (U1) |
| RS5 | Aprovar sobre dado desatualizado | `snapshot` no pedido; conflito ⇒ `expired` sem aplicar |
| RS6 | Contrato novo (409/202) confundir clientes | Só endpoints do painel (gerente); o app não edita/exclui perdas nem produtos; campo `justification` é aditivo |
| RS7 | Migrations no banco real | Tabelas novas + triggers: rápidas; aplicar junto com a janela de manutenção de 10000–14000 |

## 7. Ambiente e verificação

- Baselines no início do SP2: backend 21 suítes / 151 unitários, 17 arquivos / 94 de integração; web 37 /
  162; app 37 (`flutter test`, estável em paralelo). `tsc` e `flutter analyze` limpos.
- Toda migration nova segue: predicado `TENANT_COMPANY_ID_PREDICATE`, `SET search_path` em funções,
  `withoutForcedRls` para backfill, teste em banco próprio quando houver backfill.
- Cada etapa: TDD, revisão final por revisor independente, verificação no navegador para mudanças de tela,
  `superpowers:verification-before-completion`.

## 8. Definição de pronto do SP2

1. Toda mudança nos cadastros, perdas, usuários, configurações e faturamento aparece no Histórico e na
   página Auditoria; logins e importações aparecem como eventos; o log não pode ser alterado nem apagado.
2. As quatro mudanças sensíveis respeitam a política da empresa: aprovação por outro gerente (2+) ou
   justificativa (1).
3. Correção retroativa de preço com prévia, justificativa, auditoria e aprovação quando exigida.
4. Motivos e Locais usam os blocos do motor sem mudança de comportamento.

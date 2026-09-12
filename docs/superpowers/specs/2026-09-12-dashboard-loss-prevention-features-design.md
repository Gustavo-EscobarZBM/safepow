# Novas funcionalidades de dashboard e prevenção de perdas

Data: 2026-09-12
Status: Aprovado — pronto para implementação

## Contexto

O dashboard gerencial (web-panel) hoje mostra: KPIs de prejuízo/quantidade do mês,
produto e motivo mais frequentes, gráfico de tendência, composição por
motivo/local, top ofensores e alertas baseados em regras fixas
(`LossesService.reportSummary/reportByProduct/reportByPeriod/reportByReason/
reportByLocation/reportAlerts`). O "prejuízo financeiro" é calculado como
`quantidade × unitPrice` (preço de venda) — não existe noção de custo, de
faturamento da empresa, de motivo evitável, de comportamento suspeito nem de
um fluxo de conferência sobre o que foi descartado.

Esta spec cobre cinco iniciativas independentes, nesta ordem de implementação:

1. Preço de custo do produto
2. Projeção de fechamento de mês
3. Taxa de perda sobre faturamento
4. Score de padrão suspeito
5. Conferência de descarte

Cada uma é entregável e verificável isoladamente. As quatro primeiras não
tocam o app mobile — só backend e web-panel. A quinta é a única que muda o
fluxo do app mobile.

## 1. Preço de custo do produto (`costPrice`)

**Motivação:** o prejuízo hoje usa preço de venda. Controle de perdas de
estoque tradicionalmente mede o custo real perdido (o que a empresa pagou),
não a receita que deixou de ganhar.

**Backend**
- Migration: coluna `costPrice numeric(12,2) not null default 0` em `products`.
- `CreateProductDto`/`UpdateProductDto`: campo opcional `costPrice`.
- `ProductsService`: grava `costPrice` no create/update.
- `LossesService`: `reportByProduct` e `reportSummary` passam a calcular também
  `totalCostLoss` (quantidade × costPrice) ao lado de `totalFinancialLoss`
  (quantidade × unitPrice, mantido como está — receita perdida).

**Web-panel**
- Formulário de produto (Cadastros): novo campo "Preço de custo".
- Dashboard: KPI de prejuízo passa a mostrar as duas visões (custo vs. receita
  perdida) — decisão de layout durante a implementação (ex: toggle ou dois
  cards lado a lado).

**Mobile:** nenhuma mudança (o app não edita nem exibe preço de produto).

## 2. Projeção de fechamento de mês

**Motivação:** hoje só existe comparação entre mês atual completo e anterior
completo. Uma extrapolação simples avisa antes do mês fechar.

**Backend**
- Novo cálculo (sem tabela nova): a partir da série diária já usada em
  `reportByPeriod` do mês corrente até a data de hoje, extrapola linearmente
  para os dias restantes do mês. Exposto como campo novo em `reportSummary`
  (ex: `projectedMonthEnd: { totalFinancialLoss, totalQuantity }`).

**Web-panel**
- Dashboard: novo KPI/aviso "no ritmo atual, você deve fechar o mês com
  prejuízo de R$ X (~Y% vs. mês anterior)".

**Mobile:** nenhuma mudança.

## 3. Taxa de perda sobre faturamento (shrinkage rate)

**Motivação:** prejuízo em valor absoluto não diz se é grave ou não sem saber
o tamanho do negócio. A métrica padrão do varejo é perda ÷ faturamento.

**Backend**
- Nova tabela `company_monthly_revenue` (`companyId`, `year`, `month`,
  `revenueAmount`, timestamps) com unique index `(companyId, year, month)`.
  RLS igual às demais tabelas de tenant (`tenant_isolation_company_monthly_revenue`).
- Endpoints novos (papel MANAGER): `PUT /company-revenue/:year/:month` (cria
  ou substitui o valor do mês) e `GET /company-revenue?year=&month=` (ou uma
  listagem dos últimos N meses).
- `reportSummary` passa a incluir `shrinkageRate` (perda do mês ÷ faturamento
  do mês, `null` se não houver faturamento cadastrado para o mês).

**Web-panel**
- Novo campo/tela para o gerente informar o faturamento do mês (ex: dentro de
  Cadastros ou um card no próprio dashboard).
- Dashboard: exibir a taxa (%) ao lado do prejuízo absoluto, com selo de
  comparação à faixa "normal" do varejo (1–2%) quando houver faturamento
  cadastrado.

**Mobile:** nenhuma mudança.

## 4. Score de padrão suspeito

**Motivação:** hoje uma perda é o que o funcionário diz que é, sem nenhum
sinal de revisão. Cruzar sinais já existentes ajuda o gerente a saber onde
olhar com mais atenção — sem acusar automaticamente.

**Backend**
- Novo endpoint de relatório (ex: `GET /losses/reports/suspicious-patterns`)
  que cruza, por funcionário/produto, sinais já existentes: perdas
  concentradas no mesmo produto de alto valor, ausência de foto, ausência de
  descrição, concentração de valor por um único funcionário. Produz uma lista
  ordenada por "score" com o motivo do destaque — não bloqueia nem altera o
  registro, é só leitura agregada.

**Web-panel**
- Dashboard: novo card "Padrões para revisar", listando os itens de maior
  score com o porquê.

**Mobile:** nenhuma mudança.

## 5. Conferência de descarte

**Motivação:** hoje o registro do funcionário é definitivo, sem nenhuma
segunda validação. Empresas que queiram esse controle extra podem ativar uma
etapa de conferência opcional.

**Modelo de dados**
- `companies`: `lossVerificationEnabled boolean not null default false`,
  `lossVerifierId uuid null references users(id)`.
- `losses`: `requiresVerification boolean not null default false` (travado no
  momento da criação — mudar a configuração depois não afeta perdas já
  criadas), `verifiedAt timestamptz null`, `verifiedByUserId uuid null
  references users(id)`.

**Backend**
- Novo endpoint para o gerente editar as próprias configurações de empresa —
  hoje só existe edição pelo Painel Master (`/master/companies/:id`), restrito
  a `MASTER_ADMIN`. Precisa de uma rota nova, escopada pelo tenant do
  gerente autenticado, limitada a `lossVerificationEnabled`/`lossVerifierId`
  (nunca aos campos de billing/status). Sugestão: `GET/PATCH
  /companies/me/settings`.
- `LossesService.create`: se `company.lossVerificationEnabled`, grava a perda
  com `requiresVerification = true`.
- `GET /losses/pending-verification`: lista perdas com
  `requiresVerification = true AND verifiedAt IS NULL`. Acesso: o
  `lossVerifierId` da empresa OU qualquer usuário com papel MANAGER da mesma
  empresa.
- `PATCH /losses/:id/verify`: marca `verifiedAt`/`verifiedByUserId`. Mesma
  regra de acesso acima.

**Web-panel**
- Nova seção de configurações da empresa (Cadastros ou página própria):
  checkbox "Ativar conferência de descarte" + seletor do conferente (lista de
  usuários da empresa via `GET /users`).
- Nova página "Conferências" listando pendências com botão de confirmar —
  visível para qualquer gerente.

**Mobile**
- Fluxo de registro de perda (`loss_form_screen.dart`): quando a perda criada
  tiver `requiresVerification = true`, em vez do comportamento atual
  (mensagem + volta automática para a Home), mostra um pop-up informando que o
  registro foi encaminhado para conferência, com dois botões: "Registrar nova
  perda" e "Voltar à tela inicial". Empresas sem a função ativada mantêm o
  comportamento atual, sem nenhuma mudança visível.
  - O aviso aparece no momento do registro local (mesmo padrão otimista que o
    app já usa para "será sincronizado automaticamente"), não apenas após a
    sincronização real com o servidor.
- Nova tela "Conferências pendentes", acessível a partir da Home **somente**
  para quem é o `lossVerifierId` da empresa ou tem papel MANAGER. Busca ao
  vivo do servidor (sem cache local — a lista depende de registros de outros
  funcionários, não faz sentido cachear offline). Lista as pendências com
  botão "Confirmar", chamando `PATCH /losses/:id/verify`.
- HomeScreen: novo botão/entrada condicional para a tela de Conferências,
  com contagem de pendentes (mesmo padrão visual já usado em "Ver registros").

## Fora de escopo (explicitamente removido durante o brainstorming)

- Motivo evitável/inevitável e calculadora de economia potencial — descartada.
- Geolocalização no registro da perda — descartada por enquanto.
- Notificação push real (FCM/e-mail) para o conferente — o aviso é só um
  pop-up dentro do próprio app do funcionário; o conferente vê a lista quando
  abre a tela de Conferências, não recebe notificação externa.
- QR code / confirmação física em duas etapas do descarte — a "conferência"
  aqui é uma aprovação digital simples (ver/confirmar), não uma cadeia de
  custódia física.

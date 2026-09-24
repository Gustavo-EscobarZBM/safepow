# Cadastros 2.0 — desenho mestre

Data: 2026-09-20
Status: **Rascunho para aprovação — nada foi implementado.**

## 0. Como ler este documento

O pedido ("aplicar mudanças bruscas em cadastros", com ~30 ideias) cobre vários
subsistemas independentes. Um único plano de implementação para tudo seria
inviável de revisar e arriscado de entregar. Por isso este documento:

1. registra o **estado atual verificado no código** (seção 1);
2. lista as **falhas que já existem** e que as ideias precisam corrigir ou contornar (seção 2);
3. fixa as **decisões de arquitetura transversais** (seção 3);
4. **decompõe em 9 subprojetos (SP1–SP9)**, cada um entregável sozinho (seção 4);
5. detalha cada subprojeto com **modelo de dados, API, web, mobile, falhas/riscos e complementos** (seção 5);
6. define testes, migração e rollout (seção 6), riscos globais (7), decisões pendentes (8) e a cobertura de cada ideia original (9).

Cada SP ganha seu **próprio spec detalhado → plano → implementação com TDD** quando chegar a
vez dele. Este documento é o mapa; aprovar aqui = aprovar a decomposição, a ordem e as
decisões da seção 3.

Convenções: `F#` = falha existente · `A#` = decisão de arquitetura · `D#` = decisão pendente ·
➕ = complemento sugerido além do que foi pedido. Referências `arquivo:linha` foram lidas no código
em 2026-09-20; o que **não** verifiquei está marcado como "a verificar".

---

## 1. Estado atual (verificado)

| Área | Hoje |
|---|---|
| Multi-tenant | 1 banco, `companyId` em toda tabela de negócio, **RLS + FORCE** por tabela; contexto por requisição via `TenantContextMiddleware` (uma transação por requisição, `set_config('app.current_company_id')`). |
| Produto | `barcode` (único por empresa), `sku`, `name`, `unitPrice`, `costPrice`, `sourceColumnMapping` (jsonb **por linha**), `isActive`. Sem categoria, fornecedor, unidade, foto. |
| Motivo/Local | Tabelas só com `name` (únicas por empresa). Exclusão só se nunca usados (FK `RESTRICT`). Semeados com 5 motivos / 6 locais ao criar a empresa. |
| Usuário | 3 papéis (`master_admin`, `manager`, `employee`); gerente cria o usuário **já com senha**; e-mail único **global**; conferente = 1 id em `companies.lossVerifierId`. |
| Empresa | nome, CNPJ, status/cobrança, `planTier` (texto livre), flags de conferência. Sem lojas. |
| Importação | `.xlsx`, fila BullMQ, colunas: código de barras, nome, SKU (backend), preço de venda. Sem custo, sem pré-visualização. |
| App | SQLite `version: 1` só com `onCreate`; catálogo de produtos por sync incremental (`?since`); motivos/locais baixados por inteiro; fila de perdas offline com idempotência por `clientGeneratedId`. |
| Perda | Sem valor congelado: todo relatório faz JOIN com o preço **atual** do produto. |

---

## 2. Falhas encontradas no que já existe

| ID | Falha | Evidência | Impacto | Corrigida em |
|---|---|---|---|---|
| F1 | **Valor histórico das perdas muda quando o preço muda.** Todo relatório, alerta, score e export usa `product.unitPrice/costPrice` atual. | `losses.service.ts:132,133,200,201,225,243,265,303,442`; `losses-suspicious-patterns.ts:56,96,140`; `losses-alerts.ts:73` | Editar um preço reescreve o dashboard inteiro; prejuízo passado não é confiável nem auditável. | SP1 |
| F2 | **Produto excluído não pode ser recadastrado** ("já existe") e não há tela para ver/reativar arquivados. | `products.service.ts:21` (checagem sem filtrar `isActive`) + índice único `uq_products_company_barcode` | Gerente fica sem saída; importação de produto arquivado também não o reativa (F9). | SP1 |
| F3 | **Sync incremental não propaga exclusões.** `findAll(since)` só devolve `isActive = true`; o app só faz upsert. | `products.service.ts:42-48`; `product_repository.dart:36-46` | Produto arquivado continua no celular, escaneável, e perdas seguem sendo registradas nele. | SP1 |
| F4 | **Cursor do sync usa o relógio do celular** (`DateTime.now()`) comparado com `updatedAt` do servidor. | `product_repository.dart:20,48` | Relógio adiantado no aparelho ⇒ mudanças perdidas para sempre (até re-sync total). | SP1 |
| F5 | **Confirmado (SP1 etapa 1.1, `updated-at-semantics.int-spec.ts`): `updatedAt` é exatamente o `now()` da transação (início), não o instante da gravação** (semântica de `CURRENT_TIMESTAMP` no Postgres). Requisições ficam numa transação até o `res.end` (o commit é feito antes de a resposta ser entregue — ver F16); importações longas ficam minutos numa só. | `tenant-context.middleware.ts` (`finishTransactionBeforeResponse`); `imports.processor.ts:37` | Linha alterada durante um sync pode ter `updatedAt` **anterior** ao cursor já gravado ⇒ nunca chega ao app (importação grande é o pior caso). | SP1 (janela de sobreposição) + SP3 (lotes) |
| F6 | **SQLite sem migração de schema** (`version: 1`, só `onCreate`). | `app_database.dart:24-27` | Qualquer coluna nova (categoria, regras de motivo, produto pendente…) exige `onUpgrade` — hoje inexistente; risco de apagar a **fila de perdas ainda não sincronizadas**. | SP1 (infra) |
| F7 | **Token vale até 8 h sem checar o usuário.** O middleware só verifica a assinatura; `isActive`/`role` só são lidos no login. | `tenant-context.middleware.ts:35`; `app.module.ts:71` | Desativar funcionário ou mudar papel só vale no próximo login. | SP7 |
| F8 | **Conferente pode confirmar a própria perda.** `verify()` não compara `reportedByUserId` com quem confere. | `losses.service.ts:409-422` | Quebra a separação de funções da conferência. | SP7 (correção pontual pode antecipar) |
| F9 | **Importador:** (a) não lê custo; (b) coluna SKU existe no backend mas a tela não envia; (c) upsert não reativa arquivado; (d) `findOne` + `save` por linha e tudo numa única transação; (e) `String(cell.value)` quebra com célula de fórmula/texto rico (`[object Object]`) e perde zeros à esquerda em códigos numéricos; (f) `Number("12,50")` = `NaN` (vírgula decimal, padrão de ERPs brasileiros); (g) `sourceColumnMapping` gravado em **cada produto criado** (jsonb repetido por linha). | `imports.processor.ts:84-136`; `column-mapping.dto.ts`; `produtos/page.tsx:190-197` | Importações lentas, erros falsos de preço, códigos de barras corrompidos, custo sempre 0. | SP3 |
| F10 | **Lista/sync carregam o catálogo inteiro** (painel filtra no navegador; `GET /products` sem paginação). | `produtos/page.tsx:49,63-72`; `products.service.ts:49` | Não escala para catálogos de dezenas de milhares. | SP1 |
| F11 | **`findByBarcode` não filtra arquivados.** | `products.service.ts:52-59` | Consulta por código devolve produto arquivado. | SP1 |
| F12 | Motivos/locais **só podem ser excluídos**, não arquivados; renomear reflete no histórico (aceitável) mas não há como "aposentar" um item usado. | `loss-reasons.service.ts:54-67` | Listas do app enchem de itens obsoletos. | SP5 |
| F13 | E-mail **único global** (`uq_users_email`). | `1700000000000-InitialSchema.ts:59-61` | Consultor/gerente regional em duas empresas é impossível; funcionário sem e-mail não tem como logar. | SP7 (D2) / SP8 |
| F14 | Cadastro de usuário: gerente define a senha, sem troca obrigatória, sem reset, sem `lastLoginAt`. | `users.service.ts:21-43` | Senhas compartilhadas por WhatsApp; nenhuma visão de contas ociosas. | SP7 |
| F15 | `planTier` é texto livre; o comentário fala em limites, mas não vi limite aplicado em nenhum arquivo lido. | `company.entity.ts:41`; `companies.service.ts:64,161` | Plano não gera nenhuma restrição real. | SP8 |
| F16 | **Confirmado e corrigido (SP1 etapa 1.1).** O commit da transação acontecia depois do evento `finish`, ou seja, depois de a resposta sair; falha de commit era engolida (cliente recebia sucesso sem gravação). | `tenant-context.middleware.ts` (antes: linhas 63-72) | Leitura após escrita inconsistente (app sincronizando logo após a resposta) e sucesso falso em falha de commit. | SP1 — feito |
| F17 | Não há validação de dígito verificador de código de barras que eu tenha visto; o DTO de criação não foi lido. | a verificar em `create-product.dto.ts` | Códigos digitados errados viram produtos "fantasmas". | SP4 |
| F18 | Numa conexão reaproveitada do pool, `current_setting('app.current_company_id', true)` devolve `''` (não `NULL`) e o cast `''::uuid` das políticas de RLS falha para requisições sem tenant (ex.: `master_admin`). | `rls-isolation.int-spec.ts` (teste `it.failing`); políticas em `1700000000000-InitialSchema.ts:124-140` e migrations seguintes | Requisições do `master_admin` podem falhar de forma intermitente, dependendo da conexão sorteada. | Decisão pendente (migration com `NULLIF`, inclusive no ramo `… IS NULL` da política de `users`, que também precisa de `NULLIF(…, '') IS NULL`; senão as linhas do `master_admin` ficam invisíveis) |

---

## 3. Decisões de arquitetura transversais

**A1 — Valor congelado + histórico de preço.** Cada perda guarda `unitPriceAtLoss`/`unitCostAtLoss`
(resolvidos pelo preço vigente em `occurredAt`, não na hora do sync). Produto passa a ter histórico
append-only de preço/custo. Todo relatório passa a somar o valor congelado.

**A2 — Ciclo de vida uniforme.** Tudo o que é cadastro é **arquivável e reativável** (nunca "excluir"
se há histórico). Exclusão definitiva só para registro sem nenhuma referência.

**A3 — Sync delta com tombstones, cursor do servidor e sobreposição.** O servidor devolve também
os registros arquivados **apenas quando o cliente pede** (`includeArchived=true` — o app antigo ignora
`isActive` e trataria o arquivado como ativo; ver A5), o app apaga localmente, o servidor envia o cursor
no cabeçalho `X-Sync-Cursor` (apps antigos ignoram) e o app sempre pede `since = cursor − 2 min`
(upserts idempotentes). Paginação por *keyset* (`limit` + `after`) com cursor de **precisão total**
(microssegundos + `id`), senão importações com `updatedAt` idêntico causam loop infinito. Importações
gravam em lotes de ~500 linhas, cada lote numa transação própria com `updatedAt` explícito.
Detalhes e testes: [spec do SP1](2026-09-20-sp1-fundacao-de-dados-design.md).

**A4 — Migrações do app são aditivas.** `onUpgrade` ordenado; nunca recria `losses` (fila não
sincronizada é o único dado irrecuperável do aparelho); tabelas de catálogo podem ser recriadas
(re-baixáveis).

**A5 — Compatibilidade retroativa da API.** O app na loja atualiza devagar: toda mudança de API é
**aditiva** (campos opcionais, endpoints novos). `GET /products` (sync) continua devolvendo lista;
o painel usa endpoint novo paginado. ➕ Endpoint `GET /app-config` com `minSupportedVersion` para
forçar atualização quando um SP exigir.

**A6 — Toda tabela nova segue o molde de RLS** de `1700000004000-LossCatalogs.ts`: `ENABLE` +
`FORCE ROW LEVEL SECURITY` + política `companyId = current_setting('app.current_company_id', true)::uuid`
(USING e WITH CHECK) + `GRANT` ao role `inventory_saas_app` se existir. Checklist obrigatório em
todo SP.

**A7 — Auditoria explícita, não mágica.** `AuditService.record(manager, …)` chamado pelos serviços
(com `diff(before, after, campos)`), em vez de subscriber do TypeORM — assim funciona no worker de
importação (que não tem contexto de tenant) e em `update()` por query builder. Trade-off: exige
disciplina; mitigado por teste que percorre os serviços de cadastro e falha se um método mutante
não auditar.

**A8 — Permissões por capacidade.** `RolesGuard` continua existindo; ganha-se `@Can('recurso.acao')`
com matriz papel→capacidades em código (testada exaustivamente). Papéis novos entram por
migração de enum sem transação (ver risco no SP7).

**A9 — Preparado para lojas sem criar lojas agora (D1).** Nenhum desenho novo pode assumir
"1 empresa = 1 loja": unicidades por `(companyId, parentId, name)`, capacidades com escopo, etc.
O schema de lojas só nasce no SP8, com a "Matriz" criada para todas as empresas existentes e
**modo loja única** (a UI esconde o conceito de loja enquanto houver uma só).

**A10 — Feature flags por empresa** (`companies.features jsonb`) para liberar cada SP gradualmente
e servir de base aos limites de plano (SP8).

---

## 4. Decomposição e ordem

```
SP1 Fundação de dados ──┬─► SP2 Auditoria + motor ──┬─► SP4 Produtos 2.0 ──┬─► SP6 Cadastro rápido
                        │                            │                      └─► SP9 Integração ERP
                        ├─► SP3 Importação 2.0 ◄─────┘ (usa SP4 em fases)
                        │                            ├─► SP5 Taxonomias de perda
                        │                            └─► SP7 Usuários e acesso ──► SP8 Lojas
```

| SP | Nome | Tamanho relativo | Depende de |
|---|---|---|---|
| SP1 | Fundação de dados | L | — |
| SP2 | Auditoria, aprovações e motor de cadastros | L | SP1 |
| SP3 | Importação 2.0 e exportação | XL | SP1 (SP2 para auditoria) |
| SP4 | Produtos 2.0 | XL | SP1, SP2 |
| SP5 | Taxonomias de perda (motivos e locais) | L | SP1, SP2 |
| SP6 | Cadastro rápido em campo | L | SP1, SP4 (campos), SP2 |
| SP7 | Usuários, papéis e acesso | XL | SP2 |
| SP8 | Lojas e filiais | XL | SP7 |
| SP9 | Integração com ERP | L | SP3, SP4 |

**Ordem recomendada:** SP1 → SP2 → SP3 → SP4 → SP6 → SP5 → SP7 → SP8 → SP9.
Motivo: SP1–SP2 corrigem os furos e criam as peças que todo o resto reaproveita; SP3–SP4 entregam o
maior valor para o gerente; SP6 depende do que SP1/SP4 preparam no app; SP8 só compensa depois de
papéis e auditoria estáveis, porque toca todas as consultas.

---

## 5. Subprojetos

### SP1 — Fundação de dados

**Objetivo:** tornar o dado confiável (valor histórico), o ciclo de vida completo (arquivar/reativar),
o sync do app correto e o painel escalável. Corrige F1–F6, F10, F11 (e testa F16).

**1.1 Valor congelado da perda (F1)**
- `losses`: `unitPriceAtLoss numeric(12,2)`, `unitCostAtLoss numeric(12,2)`,
  `valuationSource varchar(20)` com `CHECK` em (`snapshot`, `backfill_current`, `fallback_current`,
  `recalculated`, `pending_product`) — `varchar`+`CHECK` e não enum do Postgres, porque os SPs 5 e 6
  vão acrescentar valores. Um *trigger* `BEFORE INSERT` preenche com o preço atual e marca
  `fallback_current` se algum escritor esquecer o snapshot (SP1, decisão R3).
- Criação (`LossesService.create`): resolve preço/custo vigentes **em `occurredAt`** (via 1.2), com
  *fallback* para o preço atual. Motivo: perda registrada offline e sincronizada dias depois deve
  valer o preço da ocorrência.
- Edição pelo gerente (`update`): se mudar `productId` ou `occurredAt`, recalcula o valor;
  se mudar só descrição/quantidade, mantém o preço unitário congelado.
- Migration: adiciona colunas, **backfill** com o preço atual do produto e `valuationSource =
  'backfill_current'` (o valor real do passado é irrecuperável; dizer isso na UI). Backfill em
  lotes para não travar a tabela.
- Substituir as 7+ consultas por uma única expressão compartilhada
  (`SUM(loss.quantity * loss."unitPriceAtLoss")`), inclusive `losses-alerts.ts`,
  `losses-suspicious-patterns.ts` e o export xlsx. Os specs dessas funções puras montam `Loss` com
  `product.unitPrice` e serão reescritos junto (TDD: primeiro o teste que falha).
- ➕ **Correção retroativa de preço** ("digitei R$ 1,20 em vez de R$ 12,00"): ação explícita
  "Recalcular perdas a partir de DD/MM" que refaz o valor congelado numa janela, marca
  `valuationSource='recalculated'`, exige justificativa, entra na auditoria e passa por
  aprovação quando a política existir. Sem isso o snapshot vira uma prisão para erro de digitação.
  **Movida para o SP2** (depende da trilha de auditoria; sem ela vira caminho para esconder perdas).
- ➕ Dashboard mostra aviso discreto "valores anteriores a DD/MM usam o preço atual na data da
  migração" enquanto existirem linhas `backfill_current`. **Adiado**: `dashboard/page.tsx` tem
  mudanças não commitadas de outra frente.

**1.2 Histórico de preço**
- `product_price_history(id, companyId, productId, unitPrice, costPrice, validFrom, changedByUserId,
  source enum('manual','import','bulk','retro_fix','erp','approval'), createdAt)`, índice
  `(productId, validFrom desc)`, RLS (A6). Append-only; vigência = próxima linha.
- **Gravação por *trigger* no banco** (`AFTER INSERT OR UPDATE OF unitPrice, costPrice` em `products`),
  não por serviço: a invariante "toda mudança de preço gera histórico" vale para todo escritor (painel,
  importação, edição em massa, ERP) sem depender de disciplina. Quem/por qual origem vêm das variáveis
  de sessão `app.current_user_id` e `app.change_source`, que o middleware e o worker definem. Só grava
  quando preço **ou** custo muda. (Decisão R2 do spec do SP1.)
- Backfill: uma linha por produto com `validFrom = products.createdAt`.
- Consulta *as-of*: última linha com `validFrom <= occurredAt`. Para lotes (importação) não se faz
  consulta por linha — só escrita.
- ➕ Na edição do produto: linha do tempo de preços ("R$ 10,00 → R$ 12,00 por Maria em 12/09").
- Simplificação deliberada: o histórico **não é editável retroativamente**; correção retroativa só
  mexe no valor congelado das perdas (1.1).

**1.3 Ciclo de vida de produto (F2, F11)**
- Mantém `isActive`; "Excluir" vira **"Arquivar"** na UI. Abas **Ativos | Arquivados | Todos** e ação
  **Reativar**.
- Conflito de código de barras passa a responder `409` com `errorCode: 'PRODUCT_ARCHIVED_EXISTS'` e
  `productId`; a UI oferece "Reativar e atualizar os dados".
- `findByBarcode` filtra ativos. Importação reativa (SP3).
- ➕ **Exclusão definitiva** só para produto sem nenhuma perda (cadastro por engano), auditada.

**1.4 Sync delta correto (F3, F4, F5)**
- Endpoints de catálogo aceitam `?since=` e devolvem **também arquivados** (`isActive=false`) como
  tombstones; o app apaga o local. Só produtos precisam disso: motivos/locais são baixados por inteiro (ver SP5.3).
- Servidor devolve `X-Sync-Cursor` = `now()` do servidor; o app grava esse valor (não `DateTime.now()`)
  e consulta com sobreposição de 2 min.
- Paginação por *keyset* (`?limit=5000&after=<updatedAt>|<id>`), gzip; primeira carga de catálogo
  grande deixa de ser uma resposta única gigante.
- Importações passam a gravar em lotes de ~500 (SP3) com `updatedAt = clock_timestamp()` explícito.
- ➕ "Forçar ressincronização" em Meu perfil (app) e re-sync total automático após `onUpgrade`.

**1.5 Migração do SQLite (F6)**
- `version: 2`, mapa `migrations[version]` ordenado, sempre aditivo (`ALTER TABLE ADD COLUMN`,
  `CREATE TABLE`). Regra: nunca apagar `losses`. Testes com `sqflite_common_ffi` em memória
  (a verificar se já está nas dev dependencies) cobrindo v1→v2 com perdas pendentes.
- ➕ Diagnóstico: contagem de itens pendentes/erro visível para suporte e "exportar fila" se a
  migração falhar.

**1.6 Busca e paginação no servidor (F10)**
- `GET /products/search?q=&status=&page=&pageSize=` → `{ items, total }` (o `GET /products` do app
  não muda — A5). Busca: nome (`ILIKE`/trigram), prefixo de código de barras, SKU.
- Extensões `pg_trgm` e `unaccent` (a verificar se o Postgres gerenciado permite — D6); índice GIN em nome.

**1.7 Teste de F16:** teste de integração que faz `POST` e, sem esperar, lê por outra conexão; se
falhar, mover o commit para antes de enviar a resposta.

**Falhas/riscos do SP1**
- Backfill em tabela grande: rodar em lotes e fora do horário; `down()` remove colunas sem perder o restante.
- Ordem de deploy: migration → backend → web. App antigo continua funcionando (só recebe tombstones que ignora).
- Produto com preço 0 no momento da perda gera valor 0 congelado — coerente com `losses-alerts.ts:360`; o alerta passa a olhar o valor congelado.
- `numeric(12,2)` para custo pode truncar item vendido por peso (SP4 avalia `numeric(12,4)`).

**Testes (TDD):** resolução as-of (antes/depois/igual à vigência; sem histórico), backfill, edição
que muda produto, relatórios com preço alterado depois, conflito arquivado, tombstone no sync,
cursor com sobreposição, migração v1→v2 do app com fila preenchida.

**Fora de escopo:** lojas, categorias, importação nova.
**Pronto quando:** alterar o preço de um produto não muda nenhum valor de perda passada; arquivar no
painel remove o produto do celular no próximo sync; painel lista 100 mil produtos com busca no servidor.

---

### SP2 — Auditoria, aprovações e motor de cadastros

**Objetivo:** saber quem mudou o quê, permitir dupla checagem em mudanças sensíveis e parar de
reescrever a mesma tela de CRUD.

**2.1 Trilha de auditoria (A7)**
- `audit_log(id, companyId, actorUserId, actorRole, actorName snapshot, entityType, entityId, action
  enum(create|update|archive|restore|delete|import|bulk|approve|reject|login|permission), changes
  jsonb [{field, from, to}], source enum(web|mobile|import|system|erp), requestId, ip, createdAt)`.
- Append-only: `REVOKE UPDATE, DELETE` do role da aplicação; RLS de SELECT/INSERT.
- Nunca grava `passwordHash`/PIN — registra `password: alterada`.
- Importação grande **não** gera 50 mil linhas: 1 linha `import` com resumo + linhas individuais só
  para mudanças de preço/custo (o que importa).
- UI: gaveta "Histórico" em cada registro + página **Auditoria** (gerente/auditor) com filtros
  (entidade, usuário, período, ação) e export CSV.
- ➕ **Desfazer** edição de produto a partir do `from` do log (só campos não destrutivos).
- ➕ Retenção configurável (padrão 24 meses); particionamento mensal se o volume pedir.
- ➕ LGPD: `actorName` é *snapshot*; "anonimizar usuário" troca nome/e-mail mantendo o id.

**2.2 Aprovações (maker-checker)**
- `change_requests(id, companyId, entityType, entityId, requestedByUserId, payload jsonb, status
  pending|approved|rejected|expired, decidedByUserId, decidedAt, decisionNote, expiresAt)`.
- `approval_policies` por empresa: gatilhos (variação de custo/preço > X%, edição em massa > N
  itens, correção retroativa, mescla de produtos, exclusão de motivo/local com histórico).
- Regras: solicitante não aprova o próprio pedido; expira em 7 dias; aprovar aplica o `payload`
  com a mesma validação da operação direta.
- **Falha prevista:** empresa com **um** gerente ficaria travada. Mitigação: política só ativa com
  ≥ 2 aprovadores; alternativa "autoaprovar com justificativa" (auditada).
- ➕ Selo de pendências no menu e (quando houver provedor de e-mail — D3) aviso por e-mail.

**2.3 Motor de cadastros (blocos reaproveitáveis, não gerador de código)**
- Web: `ResourceDefinition` (colunas, campos, validações, filtros, ações em massa, permissões) +
  blocos `ResourceTable` (paginação no servidor), `ResourceFormDialog`, `ArchiveDialog`,
  `HistoryDrawer`, `ImportWizardEntry`. `CatalogManager` (só nome) e as telas de Motivo/Local migram
  primeiro; Produtos e Usuários continuam telas próprias **usando os blocos**.
- Backend: `BaseCatalogService<T>` (criar/listar/editar/arquivar/reativar, unicidade, auditoria, RLS)
  para motivos, locais, categorias, marcas, fornecedores. Os serviços de motivo e local já são
  estruturalmente idênticos (entidades e mensagens iguais) — com categorias/marcas/fornecedores
  serão 5, o que justifica a abstração (regra dos três).
- Risco: superabstração. Mitigação: extrair só o que 3+ telas repetem; nada de DSL.

**Testes:** auditoria por serviço (teste que percorre os serviços), append-only, aprovação
(auto-aprovação bloqueada, expiração), componentes do motor (vitest).
**Pronto quando:** toda edição de produto/motivo/local aparece no Histórico; mudança de custo > X% cai
na fila de aprovação; `CatalogManager` foi substituído sem mudar comportamento visível.

---

### SP3 — Importação 2.0 e exportação

**Objetivo:** importar de qualquer ERP sem sofrimento, com segurança e reversão. Corrige F9.

**3.1 Fluxo em passos (wizard)**
1. **Upload** `.xlsx`/`.csv`: `POST /imports` cria job `uploaded`, lê cabeçalho + 20 linhas de
   amostra, detecta abas, codificação (UTF-8/Windows-1252) e delimitador (`;` vs `,`), e devolve
   `suggestedMapping` por sinônimos (EAN/GTIN/Cód. barras; Descrição/Nome; Custo; Venda/Preço…).
2. **Mapeamento** por dropdown por campo; mapeamentos salvos em `import_mappings(name, resource,
   mapping, headerFingerprint)` e reaplicados quando o cabeçalho bate (resolve F9g).
3. **Simulação (dry-run)** em fila: cria/atualiza/reativa/sem mudança/erros, 20 diffs de exemplo,
   duplicatas **dentro** do arquivo e mudanças de preço suspeitas.
4. **Confirmação** com opções: quais campos sobrescrever (ex.: "não alterar preços"), "arquivar quem
   não veio na planilha" (mostra quantos; exige confirmação forte se > 20% do catálogo).
5. **Relatório** com erros baixáveis (CSV com a linha original + motivo). O `errorReport` no banco
   continua limitado a 200 linhas (só para exibir na tela); o CSV **completo** vai para o storage e é
   o que o usuário baixa.

**3.2 Processamento**
- Lotes de ~500 linhas, cada um em transação; `INSERT … ON CONFLICT (companyId, barcode) DO UPDATE`
  com pré-carga por `barcode = ANY($1)` (sem N+1); grava histórico de preço e auditoria (SP1/SP2);
  reativa arquivados; `updatedAt` explícito (A3).
- Idempotência por hash SHA-256 do arquivo ("esta planilha já foi importada em DD/MM").
- Concorrência 1 por empresa; limite de tamanho (ex.: 20 MB / 200 mil linhas) e proteção contra
  *zip bomb* (limite de tamanho descompactado no `.xlsx`).

**3.3 Normalização de células (F9e/f)**
- Fórmula → `result`; texto rico → concatena; hiperlink → `text`; data → ISO.
- Preço/custo aceitam `12,50`, `1.234,56`, `R$ 12,50`.
- GTIN: remove não dígitos; se o tamanho for suspeito (7, 11, 12) **avisa** `GTIN_LENGTH_SUSPECT`
  em vez de adivinhar zeros; valida dígito verificador como **aviso** (códigos internos de ERP são
  legítimos).
- ➕ Modelo `.xlsx` para baixar, com coluna de código já formatada como texto (evita o Excel
  comer zeros à esquerda).

**3.4 ➕ Reversão de importação**
- `import_changes(jobId, productId, action, before jsonb)` guardado 30 dias; `POST
  /imports/:id/rollback` restaura o "antes" dos itens **que não foram editados depois** e lista os
  conflitos. Complexidade média; entra como etapa final do SP3.

**3.5 Exportação**
- `GET /products/export` (xlsx/csv, filtros da tela); acima de ~20 mil linhas vira job assíncrono com
  link. O arquivo exportado tem **os mesmos cabeçalhos da importação** ⇒ edição em massa via planilha
  (exporta → edita → importa) sem precisar de ferramenta nova.
- Segurança: prefixar com `'` células que começam com `= + - @` (injeção de fórmula em CSV/Excel).
- Mesmo motor exporta motivos, locais e usuários.

**3.6** O motor é genérico: `ImportResourceHandler { fields, validateRow, upsert, key }`. Produto é o
primeiro handler; categorias/fornecedores (SP4) e usuários (SP7) entram como novos handlers.

**Riscos:** novas dependências (`csv-parse`, `iconv-lite`/`chardet`) — D6; catálogo enorme com
"arquivar ausentes" é destrutivo ⇒ confirmação forte + reversão.
**Testes:** planilhas de fixture (vírgula decimal, fórmulas, zeros à esquerda, CSV `;` em Windows-1252,
duplicatas no arquivo, cabeçalho faltando), lote com falha no meio, idempotência por hash, reversão.
**Pronto quando:** importar 50 mil linhas com custo e categoria termina em poucos minutos, mostra
simulação antes de gravar e pode ser desfeito.

---

### SP4 — Produtos 2.0

**Objetivo:** cadastro rico e limpo, com ferramentas para manter o catálogo saudável.

**4.1 Novos dados**
- Tabelas: `categories(id, companyId, name, parentId, isActive)` (máx. 3 níveis; unicidade
  `(companyId, COALESCE(parentId, '0000…'), name)` — índice por expressão, pois `NULL` não conflita
  em `UNIQUE` comum), `brands`, `suppliers(name, taxId, contact, phone, email, notes)`.
- `products`: `categoryId`, `brandId`, `supplierId` (fornecedor principal), `unit enum('UN','KG','G',
  'L','ML','CX','PCT','DZ','M')`, `isPerishable`, `shelfLifeDays`, `ncm varchar(8)`, `imageUrl`, `notes`,
  `reviewStatus enum('approved','pending')` (usado no SP6; eixo separado de `isActive`).
- ➕ `costPrice numeric(12,4)` para itens fracionados.
- Foto: upload pelo módulo de uploads existente; miniatura no cliente (sem dependência nova) —
  a verificar se o `uploads.controller` aceita outros tipos.

**4.2 Vários códigos de barras**
- `product_barcodes(id, companyId, productId, barcode, type primary|alias|pack, packQuantity)`;
  unicidade `(companyId, barcode)` **nessa tabela** (passa a ser a fonte de verdade da unicidade;
  `products.barcode` continua como espelho do principal). Backfill: uma linha por produto.
- Leitura de caixa (`pack`, `packQuantity = 12`): o app sugere quantidade 12.
- App: tabela local `product_barcodes` (migração SP1.5); `findByBarcodeLocal` passa a consultá-la.

**4.3 Produto pesável / etiqueta de balança**
- Configuração por empresa `scaleLabelFormat` (prefixo, posição/tamanho do código do item, tipo do
  valor peso|preço, tamanho, casas decimais) + `products.scaleCode`. O app decodifica o EAN da
  etiqueta → produto + quantidade (ou valor).
- **Risco alto:** formato varia por loja/balança. Mitigação: testador na tela de configuração (cola
  um código de exemplo → mostra item e quantidade decodificados) e desligado por padrão.

**4.4 Duplicados e mescla**
- Ao criar: aviso de "produto parecido" (similaridade de nome ≥ 0,6, mesma marca/categoria).
- `POST /products/:keepId/merge { mergeIds[] }`: move as perdas (valor congelado permanece),
  transforma os códigos dos mesclados em `alias`, preserva histórico de preço do mantido, arquiva os
  demais, audita e pode exigir aprovação (SP2). Diálogo mostra contagens antes de confirmar.

**4.5 Edição em massa**
- Seleção por linhas **ou** "todos os N resultados do filtro". Ações: reajuste de preço (% ou valor,
  com regra de arredondamento tipo `,99`), definir categoria/marca/fornecedor/unidade,
  arquivar/reativar. Sempre com **pré-visualização antes → depois**; limite 5 000 por operação,
  processamento assíncrono com progresso; uma linha de auditoria `bulk` + histórico de preço por item;
  política de aprovação (SP2).

**4.6 Saúde do cadastro**
- `GET /products/health`: preço 0, custo 0, custo > preço, sem categoria/fornecedor, nomes
  duplicados/parecidos, GTIN inválido (dígito), pendentes de revisão (SP6). Nota de 0–100 e
  "Corrigir agora" abre a lista filtrada com **edição em grade** (Tab/Enter). ➕ Cartão no dashboard.
- Removida a ideia "sem movimento há N meses": o sistema não tem movimentação de estoque, só perdas;
  ausência de perdas não indica problema.

**4.7 Validação de código de barras (F17)**
- Dígito verificador GTIN-8/12/13/14 como **aviso** por padrão; flag da empresa `enforceGtin` para
  bloquear. Códigos internos de ERP continuam possíveis.

**4.8 ➕ Consulta automática por GTIN (opcional, fase final)**
- Interface `GtinLookupProvider` + cache global `gtin_cache(gtin, name, brand, ncm, imageUrl, fetchedAt)`
  (dado público, sem `companyId`); flag por empresa; só o GTIN sai do sistema. Provedor, cotas e
  termos de uso **a validar** (D5); sem provedor definido, o item fica fora.

**Riscos:** migração da unicidade de código para `product_barcodes` (rodar em lotes, com verificação
de conflitos antes); catálogo com códigos duplicados legados bloqueia a migration ⇒ script de
diagnóstico antes.
**Testes:** unicidade entre principal/alias, mescla (perdas movidas, aliases criados), edição em massa
(pré-visualização == resultado), decodificação de etiqueta com tabela de casos, índice de categoria com
`parentId` nulo.
**Pronto quando:** produto tem categoria/fornecedor/unidade/foto; mesclar dois duplicados preserva
todo o histórico; reajuste em massa mostra antes/depois e é auditado.

---

### SP5 — Taxonomias de perda (motivos e locais)

**Objetivo:** transformar listas de nomes em dados que geram regra e relatório.

**5.1 Motivos com natureza e regras** *(refinado em 2026-09-20 após ler o formulário do painel, o DTO e o
fluxo de conferência — detalhamento completo abaixo)*

*Dados* — `loss_reasons` ganha:
- `nature enum('expiry','damage','theft','operational_error','supplier_issue','donation',
  'internal_use','other')`.
- `isControllable boolean NULL` — **três estados**: `true` controlável, `false` não controlável, `null`
  "não classificado" (padrão de `other`). O padrão vem da natureza e é editável; a definição de
  "controlável" é decisão de negócio do gerente (aqui: *evitável por processo/gestão da loja*), não um
  padrão de mercado.
- `countsTowardShrinkage boolean default true` — permite tirar **doação** e **uso interno** da taxa de
  perda (**D11**: muda um KPI existente, precisa de decisão).
- Regras: `requiresPhoto`, `requiresDescription` + `minDescriptionLength` (padrão 10, o mesmo limiar que
  o alerta de "descrição pobre" já usa em `losses-alerts.ts`), `verificationMode
  enum('inherit','always','never','sample')`, `verificationMinValue numeric NULL` (**valor em R$**, não
  quantidade — quantidade mistura unidades), `verificationSamplePercent int NULL`.
- `sortOrder`, `isActive`/`archivedAt`.

*Verificação por motivo (semântica fechada)* — `requiresVerification` da perda, decidido **no servidor
na criação** e travado (como já é hoje):
1. valor da perda ≥ `verificationMinValue` do motivo ⇒ **sempre** confere (vale até para `never`);
2. modo `always` ⇒ confere; `sample` ⇒ confere `verificationSamplePercent`% (decisão por hash do
   `clientGeneratedId`, tomada no servidor);
3. modo `never` ⇒ dispensa; modo `inherit` ⇒ segue a flag da empresa.
- **Falha prevista:** quem escolhe o motivo é o funcionário; `never` viraria atalho para fugir da
  conferência. Mitigação: `never` **exige** um teto de valor (regra 1) na tela, e "motivo usado por
  funcionário" já é sinal do score de padrão suspeito.

*Aplicação das regras (3 camadas)*
- **App e painel:** bloqueiam o salvar com mensagem clara.
- **Servidor, origem `web` (online):** rejeita com 400 (o usuário corrige na hora).
- **Servidor, origem `mobile` (fila offline):** **não rejeita** — grava com `ruleViolations jsonb`
  (`[{rule:'requires_photo'}, {rule:'min_description', min:10}]`) e mostra em "Pendências" do gerente.
  Rejeitar prenderia o registro em `error` para sempre, sem o funcionário poder corrigir.
- **Foto de verdade:** `CreateLossDto.imageUrl` hoje é só `@IsString()` (`create-loss.dto.ts:31-33`);
  para `requiresPhoto` valer, o servidor confere que a URL/chave pertence ao armazenamento **da empresa**
  (formato a confirmar em `storage.service.ts`), senão qualquer texto "cumpre" a regra.
- **Descrição de verdade:** o painel hoje grava `form.description || reasonName`
  (`losses-client.tsx:153`) — o texto vazio vira o nome do motivo. Para motivos com
  `requiresDescription`, esse *fallback* sai.
- Mudança de regra **não é retroativa** e não afeta perdas já criadas.

*App* — `loss_reasons` local (`id`, `name`) ganha as colunas de regra via `onUpgrade` (SP1.5). O aviso
"Esta empresa exige conferência" (`loss_form_screen.dart:95-97`, hoje lido da sessão) passa a ser por
perda: o app **estima** com preço/regra locais e o servidor decide.

*Relatório controlável × não controlável* — novo `GET /losses/reports/by-nature` →
`{ nature, isControllable, totalQuantity, totalFinancialLoss, totalCostLoss }` (usa o valor congelado do
SP1). Três baldes: **Controlável / Não controlável / Não classificado**, com variação vs. mês anterior,
detalhe por natureza e cartão no dashboard. Classificação é a **atual** do motivo (reclassificar corrige
o histórico de propósito; documentado na tela).

- ➕ **Migração sem mudar comportamento:** motivos existentes recebem natureza por nome (os 5 padrões) e
  regras **desligadas**; faixa "Aplicar sugestões" em 1 clique.
- ➕ **Mesclar motivos** ("Furto" e "Roubo" duplicados): move as perdas e arquiva o resto.
- ➕ **Recuperável de fornecedor:** `supplier_issue` alimenta um relatório "valor a recuperar" (troca/crédito).

**5.2 Locais hierárquicos (F12)**
- `loss_locations`: `parentId`, `isActive`/`archivedAt`, `sortOrder`, `path` (cache textual
  "Loja > Câmara fria > Prateleira 2"), profundidade ≤ 3; unicidade `(companyId,
  COALESCE(parentId,'0000…'), name)`. Locais atuais viram raízes (nada quebra).
- App: seleção por níveis ou busca; ordenação por **mais usados** (contador local) e `sortOrder`.
- Relatórios: agrega por raiz ou por nível escolhido (CTE recursiva ou prefixo de `path`). Mover um
  local na árvore muda o agrupamento histórico — aceito e documentado.
- ➕ **QR do local**: página imprimível com um QR por local (payload `locationId`; o servidor confere a
  empresa). O app escaneia e pré-seleciona o local. Dependência de geração de QR — D6.
- ➕ **"Repetir motivo/local do último registro"** (opção no app): quem lança 20 perdas seguidas do
  mesmo motivo poupa toques.

**5.3 Arquivar em vez de excluir (F12)**
- Motivo/local usado é arquivado; o app baixa a lista **inteira** e a substitui
  (`loss_reason_repository.dart:13-24`), então o arquivado some no próximo sync **sem precisar de
  tombstone**; permanece nos relatórios e no histórico. Exclusão definitiva só se nunca usado.

**5.4 Pacotes por segmento**
- Constantes em código: supermercado, hortifruti, farmácia, padaria/açougue, moda/varejo (motivos com
  natureza e regras + locais em árvore). `companies.segment` escolhido na criação (Painel Master) e
  botão "Importar modelo" para empresas existentes: **idempotente por nome, nunca sobrescreve**.

**Migração:** motivos existentes recebem `nature = 'other'` e regras desligadas — comportamento
idêntico ao atual até o gerente configurar; ➕ sugestão automática de natureza pelo nome dos cinco
motivos padrão.
**Testes:** regra offline gera `ruleViolations` (não rejeita) e regra online rejeita; verificação por
motivo (tabela de precedência: valor mínimo > modo > flag da empresa; `sample` determinístico);
`imageUrl` de outra empresa não cumpre `requiresPhoto`; *fallback* de descrição removido nos motivos com
regra; balde "não classificado" no relatório; unicidade com `parentId` nulo; agregação por nível;
arquivado some do app no próximo sync.
**Pronto quando:** gerente configura "Vencimento" exigindo foto; o app exige; dashboard separa
controlável de não controlável; local tem árvore e QR.

---

### SP6 — Cadastro rápido em campo

**Objetivo:** código desconhecido deixa de ser beco sem saída (hoje: `scan_screen.dart:40-48`).

**6.1 Fluxo no app**
1. Escaneia código sem cadastro → folha "Produto não cadastrado": **[Cadastrar agora]** (nome
   obrigatório ≥ 3 caracteres, não só dígitos; foto recomendada) ou **[Digitar de novo]**.
2. Aviso de dígito verificador inválido em digitação manual.
3. O app cria um **rascunho local** (`pending_products`, com UUID gerado no aparelho) e segue para o
   formulário da perda. Novas leituras do mesmo código no aparelho encontram o rascunho.

**6.2 Sincronização atômica (sem fila de dois estágios)**
- `POST /losses` aceita `newProduct { barcode, name, imageUrl }` junto do `productId` do rascunho. O
  servidor: procura o produto por `barcode` (em `product_barcodes`) → se existe (outro funcionário ou o
  gerente já cadastrou), usa **o existente**; se não, cria com o UUID do rascunho,
  `reviewStatus='pending'`, preço/custo 0, `createdVia='mobile'`, `createdByUserId`. Depois grava a
  perda. Resposta devolve o `productId` **efetivo**; o app corrige o `productId` das demais perdas locais
  que apontavam para o rascunho.
- Vantagens: idempotente (barcode único), sem ordenação entre filas, sem perda de vínculo; a
  criação do produto e da perda é uma só transação.

**6.3 Valor das perdas de produto pendente**
- Nascem com `valuationSource = 'pending_product'` e valor 0. Ao **aprovar** o produto (definir
  preço/custo), o sistema recalcula essas perdas (`valuationSource = 'recalculated'`, preço vigente na
  aprovação — decisão simples e explícita). Dashboard mostra selo "N perdas com valor pendente".

**6.4 Fila "Pendentes de aprovação" (painel)**
- Selo no menu; lista com foto, nome digitado, quem, quando, nº de perdas e **sugestões de produtos
  parecidos** (SP4.4). Ações: **Aprovar e completar** (preço, custo, categoria…), **Mesclar em
  existente** (código vira alias; perdas movidas), **Rejeitar/arquivar** (perdas mantidas e sinalizadas),
  aprovação em lote.

**6.5 Controle de abuso e configuração**
- Configuração por empresa **"Permitir cadastro rápido no app"** (padrão **desligado**) e limite diário
  por usuário (padrão 30); capacidade `products.quickCreate` (SP7).

**6.6 Ranking de códigos não encontrados**
- App registra leituras sem produto em `unknown_scans` local e envia em lote junto do sync →
  `unknown_barcode_scans(companyId, barcode, count, firstSeenAt, lastSeenAt)`. Só conta códigos
  numéricos de 8–14 dígitos (descarta QR e ruído). Painel: lista ordenada por frequência com ações
  "Cadastrar" (pré-preenche o código) e "Ignorar"; some sozinha quando o produto passa a existir.

**Falhas/riscos:** duas pessoas cadastram o mesmo código com nomes diferentes → vale o primeiro; o
segundo vê o nome do primeiro e a perda segue; nome ruim ("teste") → fila de aprovação e limite diário;
catálogo desatualizado no aparelho → servidor deduplica por código (F3/SP1 reduz a frequência); F16
(commit após `finish`) precisa estar resolvido/testado.
**Testes:** idempotência do envio repetido, dois aparelhos com o mesmo código, remapeamento de
`productId` local, recálculo na aprovação, limite diário, mescla.
**Pronto quando:** funcionário registra perda de produto desconhecido sem sair do app, o gerente vê na
fila, aprova, e o valor entra no dashboard.

---

### SP7 — Usuários, papéis e acesso

**Objetivo:** convite seguro, permissões finas, acesso prático para o chão de loja e correção de F7,
F8, F13, F14.

**7.1 Convite e senha**
- `users.status enum('invited','active','inactive')`, `mustChangePassword`, `lastLoginAt`.
  `user_invites(id, companyId, userId, tokenHash, expiresAt, acceptedAt)`.
- Gerente cria usuário (nome, e-mail, papel) **sem definir senha**; recebe link de uso único (72 h) para
  **copiar/compartilhar (WhatsApp) ou QR**. O próprio usuário define a senha (política: mínimo 8,
  diferente do e-mail/nome, lista embutida de senhas comuns). E-mail automático depende de provedor
  (D3 — a verificar se já existe algum).
- Redefinir senha (gerente): novo link de uso único. "Esqueci minha senha" só com e-mail configurado;
  resposta genérica (sem enumeração de usuários), token de 30 min, limite de tentativas.
- Troca obrigatória no primeiro acesso via token de escopo limitado (`scope: 'change_password'`).
- Lista de usuários ganha **último acesso** e destaca contas ociosas (➕ sugestão de desativar).

**7.2 Revogação de sessão (F7)**
- `users.tokenVersion`. O middleware faz **uma** consulta leve por requisição (cache em memória de 30 s)
  para `isActive`, `role`, `tokenVersion` (e, no SP8, escopo de lojas); desativar, trocar papel ou senha
  incrementa a versão e derruba os tokens antigos em até 30 s.
- **D4:** manter JWT de 8 h com `tokenVersion` (simples) **ou** access de 1 h + refresh rotativo por
  dispositivo (melhor para o app — sessão não expira no meio do turno — mas mexe no app e na sessão em
  cookie do Next).

**7.3 Papéis e capacidades (A8)**
- Papéis: `MASTER_ADMIN`, `MANAGER` (administrador da empresa), `SUPERVISOR` (dashboard, aprova
  pendentes e conferências, sem usuários/configurações), `VERIFIER` (conferente — inclui o que o
  funcionário faz), `EMPLOYEE`, `AUDITOR` (somente leitura, inclusive auditoria).
- Matriz `papel → capacidades` em código (`products.write`, `products.quickCreate`,
  `verification.confirm`, `approvals.decide`, `audit.read`…) + `@Can()`; teste que percorre todos os
  endpoints e falha se algum não declarar permissão.
- **Risco técnico:** `ALTER TYPE … ADD VALUE` não pode ser usado na mesma transação em que é criado e o
  TypeORM roda migrations em transação ⇒ migration com `transaction = false` (ou coluna `varchar` +
  `CHECK`).
- Conferente deixa de ser 1 id em `companies.lossVerifierId`: vira papel/capacidade, **vários**
  conferentes; migração converte o atual em `VERIFIER`.
- **F8:** `verify()` passa a recusar quem registrou a perda (`reportedByUserId === userId`), sem exceção;
  correção pequena e independente, pode ir antes do resto do SP7.

**7.4 Acesso por PIN/crachá em aparelho compartilhado**
- Pareamento: gerente gera código → aparelho recebe `deviceToken` (guardado em armazenamento seguro) →
  `devices(id, companyId, name, tokenHash, lastSeenAt, revokedAt)`. `users.badgeCode` (único por empresa)
  e `pinHash` (4–6 dígitos).
- Segurança: PIN só vale **com** aparelho pareado (sem o token, força bruta pela internet é inviável);
  bloqueio após 5 erros com espera crescente; PIN só para `EMPLOYEE`/`VERIFIER` (nunca gerente);
  auto-logout por inatividade; troca rápida de usuário; revogar aparelho no painel.
- ➕ `losses.deviceId` para análise de fraude (mesma conta em vários aparelhos, ou vice-versa).
- ➕ Lista de dispositivos com último uso e botão revogar.

**7.5 Login sem e-mail (F13, D2)**
- Funcionário de estoque geralmente não tem e-mail. Opção: `users.username` + `companies.slug`; login
  aceita e-mail **ou** `usuario@codigo-da-empresa`. A função SQL `auth_lookup_user_by_email` ganha
  variante por slug. Sem isto, o PIN/crachá cobre o caso do aparelho compartilhado, mas não o do celular
  pessoal.

**7.6 Importação de usuários**
- Handler do motor do SP3: gera convites em massa; ➕ folha imprimível com QR de convite e (se PIN)
  PINs mostrados **uma única vez**.

**Riscos:** mexe em login, JWT, app e painel ⇒ feature flag e compatibilidade com tokens antigos durante
a transição; e-mail global (F13) permanece até o SP8 (consultor multiempresa fica fora de escopo).
**Testes:** matriz de capacidades exaustiva, revogação imediata, convite expirado/reutilizado, bloqueio
por tentativas, PIN sem aparelho pareado, conferência da própria perda.
**Pronto quando:** gerente convida sem ver a senha, desativar derruba o acesso em segundos, existe papel
Supervisor/Auditor e o conferente não confirma a própria perda.

---

### SP8 — Lojas e filiais

**Objetivo:** uma empresa com várias lojas, escopo por loja e comparação entre elas. Toca quase todas as
consultas — por isso vem depois de SP7 e atrás de feature flag `multiStore`.

**8.1 Modelo**
- `stores(id, companyId, code, name, cnpj, address…, timezone default 'America/Sao_Paulo', isActive,
  archivedAt)`; migration cria a **Matriz** de cada empresa existente. `user_stores(userId, storeId)` e
  `users.storeScope enum('all','selected')`.
- `losses.storeId NOT NULL` (backfill = Matriz); `loss_locations.storeId NULL` (nulo = todas as lojas);
  `product_store_settings(productId, storeId, unitPrice, costPrice, isAvailable)` como **sobreposição**
  de preço/custo; o valor congelado usa a sobreposição da loja, senão o global. Faturamento
  (`company_monthly_revenue`) ganha versão por loja opcional; taxa de perda por loja usa o da loja, a da
  empresa usa a soma quando todas informarem.
- **Modo loja única:** empresa com 1 loja não vê seletores nem colunas de loja (zero regressão).

**8.2 Escopo e segurança**
- Escopo resolvido pelo mesmo lookup do middleware (7.2), **não** em claims do JWT (claims ficam velhas
  — F7). `StoreScopeService` aplica o filtro em toda consulta; **defesa em profundidade** com política RLS
  adicional em `losses` usando `app.current_store_ids` (a tabela mais volumosa e sensível). Índice
  `(companyId, storeId, occurredAt)`.
- Testes por endpoint: "funcionário da loja A não lê a loja B", inclusive relatórios, export e alertas.

**8.3 App**
- Login devolve as lojas do usuário; com uma loja, seleciona sozinho; com várias, "Loja atual" persistida;
  perda carrega `storeId`; locais filtrados pela loja; migração local SP1.5.

**8.4 Dashboard e gestão**
- Filtro multi-loja, **ranking/comparativo** (taxa de perda por loja, normalizada por faturamento),
  gerente regional = `MANAGER` com subconjunto de lojas. ➕ Destaque de *outliers* (loja muito acima da
  média das demais).

**8.5 Planos e limites (F15)**
- Registro de planos em código (`starter`, …: máx. lojas/usuários/produtos, recursos como cadastro
  rápido, multiloja, retenção de auditoria) + `companies.limitOverrides jsonb` editável no Painel Master;
  `PlanLimitsService.assert()` nas criações; medidores "7/10 usuários" na UI. `planTier` livre é
  normalizado por migration (valor desconhecido → `starter`, listado num relatório para revisão manual).
- Rebaixar plano com uso acima do limite: bloqueia **novas** criações, nunca apaga.

**Riscos:** consulta esquecida sem filtro de loja vaza dado entre lojas (mitigação: RLS extra + testes por
endpoint); revenue por loja opcional pode confundir a taxa da empresa (regra de soma explícita).
**Pronto quando:** rede com 3 lojas tem funcionários isolados por loja, gerente regional vê as suas e o
dashboard compara lojas — e empresas de loja única não notam diferença.

---

### SP9 — Integração com ERP

**Objetivo:** tirar a planilha manual do caminho. **Precisa saber quais ERPs importam (D7)**; sem isso o
SP fica genérico (API + webhooks + agendamento) e conectores específicos entram sob demanda.

**9.1 API pública**
- `api_keys(id, companyId, name, prefix, keyHash, scopes[], lastUsedAt, revokedAt)`, mostrada **uma vez**;
  escopos mínimos (`products:write`, `losses:read`…); limite de taxa; ➕ *allowlist* de IP.
- `POST /integrations/v1/products/upsert` (lote ≤ 1 000, cabeçalho `Idempotency-Key`), `GET
  /integrations/v1/losses?since=`. Origem `erp` na auditoria.

**9.2 Webhooks de saída**
- `webhook_endpoints`, `webhook_deliveries`; eventos `loss.created`, `loss.verified`,
  `product.pending_created`; assinatura HMAC, retentativas com espera crescente, log de entregas e
  reenvio manual. Proteção **SSRF** (só `https`, bloqueia IPs privados/loopback).
- ➕ Feed de perdas no layout que o ERP usa para dar baixa (o export atual já cita esse uso em
  `losses.service.ts:277-283`).

**9.3 Importação agendada**
- `import_schedules` (URL ou SFTP + mapeamento salvo do SP3); credenciais criptografadas em repouso
  (chave em variável de ambiente/KMS).

**9.4 Quem manda em cada campo**
- `fieldOwnership` por empresa (`{ unitPrice: 'erp', name: 'erp', categoryId: 'panel' }`): campos do ERP
  ficam bloqueados na UI ("gerenciado pelo ERP"); o restante segue livre. **Falha prevista:** dois
  escritores em conflito → padrão: o ERP vence nos campos que ele envia, com aviso na tela.

**Riscos:** superfície de ataque nova (chaves, webhooks, SFTP) → revisão de segurança dedicada antes de
liberar; contratos versionados (`/v1`).
**Pronto quando:** um ERP consegue enviar produtos por API/agenda e receber as perdas por webhook, tudo
auditado e limitado por escopo.

---

## 6. Testes, migração e rollout

- **TDD** (CLAUDE.md): teste falhando primeiro em cada mudança. Backend `jest`, web `vitest`, app `flutter test`.
- **Lacuna a confirmar:** não vi um harness de **integração com Postgres real**. Backfills, RLS,
  índices por expressão, tombstones e F16 precisam de um; proposta: `docker-compose` de teste (ou
  testcontainers) com um punhado de `*.int-spec.ts`. Vira o primeiro item do plano do SP1.
- **Migrations:** numeração contínua após `1700000009000`; molde de RLS (A6); `down()` reversível;
  backfills em lote; ensaio em cópia de dados reais antes de produção.
- **Ordem de deploy:** migration → backend → web → app. Toda mudança de API é aditiva (A5); versões
  antigas do app seguem funcionando; `GET /app-config` (➕) permite exigir atualização quando um SP
  precisar.
- **Rollout:** cada SP sai sozinho, atrás de flag por empresa quando muda comportamento (cadastro rápido,
  multiloja, papéis novos).
- **Segurança (checklist por SP):** RLS em tabela nova, upload (tipo/tamanho), injeção de fórmula no
  export, SSRF, limite de taxa, força bruta de PIN/login, revogação de token, segredos criptografados.

## 7. Riscos globais

1. **Escopo:** 9 SPs = trabalho longo; cada um precisa terminar utilizável antes do próximo começar.
2. **Dois clientes que não atualizam juntos** (app na loja vs painel): compatibilidade aditiva é regra.
3. **Multiloja tardia** toca todas as consultas: mitigado por A9 e pela ordem (SP8 após SP7).
4. **Dados históricos irrecuperáveis:** valor real do passado (F1) não volta; a UI precisa ser honesta
   sobre isso.
5. **Superabstração no motor (SP2.3):** extrair só o que se repete.

## 8. Decisões pendentes (com o padrão que adotarei se você não disser nada)

| ID | Decisão | Padrão recomendado |
|---|---|---|
| D1 | Lojas: schema já no SP1 ou só no SP8? | Só no SP8, com desenho "preparado para lojas" (A9). |
| D2 | Login sem e-mail (usuário@empresa) para quem não tem e-mail? | Sim, no SP7 (7.5). |
| D3 | Existe provedor de e-mail (SES/SendGrid/SMTP)? Qual? | Não assumir: convite por link copiável/WhatsApp; e-mail entra quando houver provedor. |
| D4 | Sessão: JWT 8 h + `tokenVersion` ou access 1 h + refresh? | JWT 8 h + `tokenVersion` agora; refresh como evolução. |
| D5 | Consulta GTIN externa: qual provedor/orçamento? | Adiar (4.8 fica fora até haver decisão). |
| D6 | Novas dependências/extensões: `csv-parse`, `iconv-lite`/`chardet`, gerador de QR, `pg_trgm`, `unaccent` | Aprovar caso a caso ao chegar no SP correspondente. |
| D7 | Quais ERPs dos clientes? | Genérico (API/webhook/agenda) e conectores por demanda. |
| D8 | Cadastro rápido padrão? Limite diário? | Desligado por empresa; 30/dia por usuário. |
| D9 | Permitir correção retroativa de valores (1.1)? | Sim, com justificativa + auditoria (+ aprovação se a política existir). |
| D10 | Por onde começar? | SP1. |
| D11 | Doação e uso interno entram na taxa de perda (KPI existente)? | **Não** entram (`countsTowardShrinkage = false` nessas naturezas), com a taxa antiga ainda visível numa nota até o gerente confirmar. |

## 9. Cobertura das ideias originais

| Ideia | SP |
|---|---|
| Cadastro rápido em campo (produto pendente) | SP6 |
| Ranking de códigos não encontrados | SP6 |
| Importação 2.0 (wizard, CSV, simulação, mapeamentos salvos, template, relatório de erros, custo/categoria/fornecedor, arquivar ausentes) | SP3 |
| Mais campos (categoria, marca, fornecedor, unidade, foto, perecível, vários códigos de barras) | SP4 |
| Produto pesável / etiqueta de balança | SP4 |
| Histórico de preço + valor congelado na perda | SP1 |
| Lixeira/arquivados e reativação | SP1 |
| Mesclar duplicados, validar EAN | SP4 |
| Edição em massa e exportar para xlsx | SP4 (massa) · SP3 (export) |
| Busca e paginação no servidor | SP1 |
| Consulta automática por GTIN | SP4.8 (opcional, D5) |
| Motivos com natureza e regras | SP5 |
| Locais hierárquicos, arquivar, ordem, QR | SP5 |
| Pacotes por segmento | SP5 |
| Lojas e filiais | SP8 |
| Convite por link/QR, reset de senha | SP7 |
| Papéis granulares (Supervisor, Conferente, Auditor) | SP7 |
| PIN/crachá em aparelho compartilhado | SP7 |
| Importação de usuários por planilha | SP3 (motor) + SP7 (handler) |
| Trilha de auditoria | SP2 |
| Aprovação para mudanças sensíveis | SP2 |
| "Saúde do cadastro" | SP4 |
| Motor de cadastros declarativo | SP2 |
| Integração com ERP | SP9 |

---

## 10. Andamento (atualizar a cada etapa)

**Pedido original do usuário (2026-09-20):** "aplicar mudanças bruscas na parte de cadastros" —
apresentar ideias úteis (inclusive as ainda não existentes), depois **estruturar e implementar todas**,
detalhar, procurar falhas e pensar em complementos. Todas as ideias da seção 9 fazem parte do escopo.

**Como retomar depois de um `/clear`:** ler este arquivo inteiro; conferir esta tabela; seguir o fluxo do
CLAUDE.md para o próximo SP (`superpowers:brainstorming` → spec do SP em
`docs/superpowers/specs/AAAA-MM-DD-spN-<tema>-design.md` → `superpowers:writing-plans` → TDD →
`superpowers:verification-before-completion`). Responder sempre em português.

| SP | Status | Spec do SP | Plano | Observações |
|---|---|---|---|---|
| — | Desenho mestre: **aprovado pelo usuário em 2026-09-20** ("dar início ao documento mestre") | este arquivo | — | Decisões D1–D11 (seção 8) valem com os padrões recomendados; o usuário não contestou nenhuma. D11 (doação/uso interno fora da taxa de perda) segue como padrão, a confirmar no SP5 |
| SP1 | Etapa 1.1 **concluída e mesclada em `main` em 2026-09-21**. Sub-etapa 1.2.1 (F18+hardening) **concluída e mesclada em `main` em 2026-09-22**. Sub-etapa 1.2.2 (migrations `ProductPriceHistory`+`LossValuationSnapshot`) **concluída e mesclada em `main` em 2026-09-23** (5 commits, fast-forward; revisão final feita, 3 achados importantes corrigidos). Sub-etapa 1.2.3 (backend do valor congelado) **concluída e mesclada em `main` em 2026-09-23** (revisão final feita, 1 achado importante corrigido — eco do datetime-local do painel recalculava o valor). Sub-etapa 1.2.4 (linha do tempo de preços no painel) **concluída e mesclada em `main` em 2026-09-23** (revisão final feita, 1 achado importante corrigido; verificada no navegador) — **etapa 1.2 concluída**. Migrations 10000–13000 aplicadas no banco de desenvolvimento em 2026-09-23. Etapa 1.3 dividida em 1.3.1 (backend) e 1.3.2 (web); **1.3.1 concluída e mesclada em `main` em 2026-09-23** (busca com 100 mil produtos abaixo de 300 ms — sem `pg_trgm`; revisão final feita, 1 achado importante corrigido — `page` enorme dava 500). **1.3.2 (web) concluída e mesclada em `main` em 2026-09-24** (verificada no navegador; revisão final feita, 1 achado importante corrigido — oferta de reativar continuava valendo após mudar o código) — **etapa 1.3 concluída**. Etapa 1.4 dividida em 1.4.1 (backend) e 1.4.2 (app); **1.4.1 concluída e mesclada em `main` em 2026-09-24**; migration 14000 aplicada no banco de desenvolvimento com autorização (revisão final sem achados críticos/importantes). Próximo: 1.4.2 (app Flutter) — decidir no plano qual `X-Sync-Cursor` guardar numa carga de várias páginas (o da 1ª página, mais conservador). Menores abertos da 1.4.1: `since`/`after` em formatos exóticos ainda dão 500 (validar com `isNaN(new Date())`); índice 14000 sem `CONCURRENTLY` entra na janela de manutenção do deploy. | [SP1](2026-09-20-sp1-fundacao-de-dados-design.md) | 1.1: [plano](../plans/2026-09-20-sp1-etapa-1-1-harness-integracao.md) (executado). 1.2.1: [plano](../plans/2026-09-21-sp1-etapa-1-2-1-f18-e-hardening.md) (executado). 1.2.2: [plano](../plans/2026-09-22-sp1-etapa-1-2-2-historico-preco-valor-congelado.md) (executado). 1.2.3: [plano](../plans/2026-09-23-sp1-etapa-1-2-3-backend-valor-congelado.md) (executado). 1.2.4: [plano](../plans/2026-09-23-sp1-etapa-1-2-4-linha-do-tempo-de-precos.md) (executado). 1.3.1: [plano](../plans/2026-09-23-sp1-etapa-1-3-1-ciclo-de-vida-e-busca-backend.md) (executado). 1.3.2: [plano](../plans/2026-09-23-sp1-etapa-1-3-2-ciclo-de-vida-e-busca-web.md) (executado). 1.4.1: [plano](../plans/2026-09-24-sp1-etapa-1-4-1-sync-backend.md) (executado). 1.2.3-1.2.4, 1.3, 1.4: planos ainda não escritos | Baselines atuais: backend 21 suítes/151 testes unitários, 17 arquivos/94 testes de integração (`npm run test:int`), tsc limpo; web-panel 37 arquivos/162 testes (`npm test`). **Pendências menores ainda abertas:** índice só em `companyId` em `product_price_history`; teste de backfill conferir FORCE também em `products`/`losses`. **Deploy:** aplicar 10000–13000 no banco real em janela de manutenção (ver resultados da 1.2.3 no spec do SP1, seção 4.2). F18 corrigido no código; **ainda não aplicado no banco de desenvolvimento** (autorização pendente). Flutter em `C:\flutter\bin` (fora do PATH). Sistema verificado funcionando de ponta a ponta em 2026-09-22 (véspera de apresentação) — ver seção 10 da memória do projeto. Cada sub-etapa seguinte só ganha plano depois de a anterior fechar |
| SP2 | Não iniciado | — | — | |
| SP3 | Não iniciado | — | — | |
| SP4 | Não iniciado | — | — | |
| SP5 | Não iniciado | — | — | |
| SP6 | Não iniciado | — | — | |
| SP7 | Não iniciado | — | — | F8 (conferente confirma a própria perda) pode ser antecipada como correção pontual |
| SP8 | Não iniciado | — | — | |
| SP9 | Não iniciado | — | — | Depende de D7 (quais ERPs) |

Ao concluir ou iniciar um SP: atualizar a linha correspondente (status, links do spec e do plano) e
registrar aqui qualquer decisão nova ou mudança de ordem.

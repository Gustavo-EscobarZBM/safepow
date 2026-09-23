# SP1 — Fundação de dados (desenho detalhado)

Data: 2026-09-20
Status: **Rascunho para revisão — nada implementado.**
Pai: [Cadastros 2.0 — desenho mestre](2026-09-20-cadastros-2-0-design-mestre.md) (seção 5, SP1).

## 0. Objetivo e escopo

Tornar o dado confiável e o ciclo de vida completo antes de qualquer funcionalidade nova:

| Falha do mestre | Correção neste SP |
|---|---|
| F1 valor histórico reescrito | valor congelado por perda + histórico de preço |
| F2 produto arquivado não reativa | arquivar/reativar com erro estruturado |
| F3 exclusões não chegam ao app | tombstones no sync (opt-in) |
| F4 cursor usa relógio do celular | cursor do servidor + sobreposição |
| F5 `updatedAt` = início da transação | confirmar por teste; sobreposição de 2 min |
| F6 SQLite sem `onUpgrade` | infra de migração + v2 |
| F10 painel carrega o catálogo inteiro | busca e paginação no servidor |
| F11 `findByBarcode` devolve arquivado | filtra ativos |
| F16 commit depois do `finish` | teste determinístico; corrigir se confirmar |

Fora de escopo deste SP: categorias/fornecedores, importação nova (só ajustes mínimos no processador
atual), auditoria, lojas, permissões, exclusão definitiva de produto, correção retroativa de preço
(vai para o SP2, depende de auditoria) e aviso de "valores estimados" no dashboard (o arquivo
`dashboard/page.tsx` tem mudanças não commitadas de outra frente; fica para depois).

## 1. Decisões refinadas em relação ao mestre

Estas decisões nasceram da leitura detalhada do código e **substituem** o texto do mestre onde divergirem
(o mestre foi atualizado em conformidade).

**R1 — Tombstones são opt-in (`includeArchived=true`).** O mestre (A3) dizia que o servidor passa a
devolver arquivados no sync incremental, mas isso quebra o A5: o app **atual** ignora `isActive` e
gravaria o arquivado como se fosse ativo (`product_repository.dart:36-46`). Só o app novo pede
`includeArchived=true`; quem não pede continua recebendo exatamente o que recebe hoje.

**R2 — Histórico de preço por *trigger* no banco.** A invariante "toda mudança de preço/custo gera uma
linha de histórico" precisa valer para **todos** os escritores (painel, importação atual, importação
2.0, edição em massa, ERP). Esquecer de chamar um serviço é o bug clássico; um *trigger* elimina a
classe inteira. O contexto (quem, por qual origem) vem de variáveis de sessão que o middleware já sabe
definir (`app.current_user_id`, `app.change_source`).

**R3 — Valor congelado calculado no TypeScript + trigger de segurança.** A regra de negócio ("preço
vigente em `occurredAt`") fica em código legível e testável. Um `BEFORE INSERT` em `losses` só entra
como rede de proteção: se algum escritor não informar o valor, preenche com o preço atual e marca
`fallback_current` (visível, auditável). Isso também resolve a janela de deploy (migration antes do
backend novo) sem o vai-e-vem *expand/contract*.

**R4 — `valuationSource` é `varchar(20)` + `CHECK`**, não enum do Postgres (`ALTER TYPE … ADD VALUE`
não convive bem com migrations transacionais; os SPs 5 e 6 vão acrescentar valores).

**R5 — Cursor de paginação com precisão total.** `updatedAt` tem microssegundos; `Date` do JavaScript,
milissegundos. Uma importação grava milhares de linhas com o **mesmo** `updatedAt`; um cursor truncado
reentregaria sempre a mesma página (loop infinito). O cursor de continuação é gerado pelo SQL
(`to_char(... 'US')`) e comparado como `timestamptz` no SQL, junto com o `id` (desempate).

**R6 — A migração v2 do SQLite é útil, não decorativa:** apaga o cursor `products_last_sync_at`, o que
força **um re-sync total** na primeira abertura após atualizar o app. Isso remove os "fantasmas"
(produtos arquivados antes desta correção que continuam no aparelho — F3) em instalações existentes.

**R7 — Sem extensões novas** (`pg_trgm`, `unaccent`) neste SP: busca com `ILIKE`; medir com 100 mil
produtos e só então decidir (D6).

**R8 — Migrations rodam nos testes como dono do banco sem ser superusuário**, imitando bancos
gerenciados (onde `FORCE ROW LEVEL SECURITY` vale até para o dono). Ver risco RK1.

## 2. Etapas e ordem

Cada etapa é entregável e verificável sozinha; cada uma ganha seu plano de implementação.

| Etapa | Nome | Toca | Depende de |
|---|---|---|---|
| **1.1** | Harness de integração + testes de caracterização (F5, F16) | backend | — |
| **1.2** | Valor congelado + histórico de preço | backend | 1.1 |
| **1.3** | Ciclo de vida do produto + busca no servidor | backend + web | 1.1 (1.2 para o histórico na UI) |
| **1.4** | Sync correto + migração do SQLite | backend + app | 1.1, 1.3 |

Ordem obrigatória: 1.1 → 1.2 → 1.3 → 1.4. Cada etapa termina com testes verdes (unitários +
integração) antes da seguinte.

---

## 3. Etapa 1.1 — Harness de integração e testes de caracterização

**Por quê:** os testes atuais mockam o `manager` (`losses.service.spec.ts:21-31`); não conseguem
exercitar RLS, `numeric`, triggers, índices nem o middleware real. Backfills e tombstones precisam de
Postgres de verdade. Estado verificado: há um Postgres 16 no Docker (`backend-postgres-1`, porta do host
**5433**) com o role de runtime `inventory_saas_app` (sem `BYPASSRLS`).

**Entrega**
- `backend/jest.integration.config.js`: `testRegex: '.*\\.int-spec\\.ts$'`, `maxWorkers: 1`,
  `globalSetup` próprio. O `jest.config.js` atual (`.*\\.spec\\.ts$`) **não** casa com `x.int-spec.ts`
  (o sufixo é `-spec.ts`, sem ponto), então `npm test` continua rápido e sem Docker.
- Scripts: `npm run test:int`.
- `backend/src/test-utils/pg-test-db.ts`:
  - `setupTestDatabase()`: como `postgres`, cria (ou recria) **`inventory_saas_test`**, com dono o role
    `inventory_saas_test_owner` (`NOSUPERUSER`), replica os `GRANT`/`ALTER DEFAULT PRIVILEGES` do
    `docker/init-db/001-create-app-role.sql` (privilégios padrão são **por banco**, então não valem
    automaticamente no banco novo) e roda as migrations como o dono.
  - `migrateUpTo(name)` e `migrateRemaining()`: permitem semear dados "legados" antes das migrations
    novas (teste de backfill) — TypeORM registra o que já rodou.
  - `adminQuery()` (superusuário, ignora RLS — só para semear/inspecionar) e `appDataSource()` (role
    de runtime, RLS ativa).
  - `withTenant({companyId, userId, role}, fn)`: abre transação no `appDataSource`, define
    `app.current_company_id` (e `app.current_user_id`), roda `tenantStorage.run(...)` e faz commit —
    o mesmo contrato do `TenantContextMiddleware`.
  - Fábricas `seedCompany`, `seedUser`, `seedProduct`, `seedLoss`, `truncateAll`.
- **Trava de segurança:** o harness aborta se o nome do banco não terminar em `_test`, e **nunca** lê
  `DB_NAME` do `.env` para escolher onde escrever. Só usa host/porta/credenciais do `.env`.
- Mensagem clara quando o Postgres não responde ("suba `docker compose up -d postgres`").

**Testes de caracterização (viram documentação executável)**
1. **F5:** dentro de uma transação, `pg_sleep(1.1)` antes de gravar um produto via `save()`; após o
   commit, `updatedAt` **é anterior** ao momento do commit em ≥ 1 s. (Se falhar, a semântica é outra e o
   desenho do cursor é revisto.)
2. **F16 (determinístico):** monta um Express mínimo com o `TenantContextMiddleware` real, sobre um
   `DataSource` cujo `commitTransaction` é atrasado 300 ms (decorator no `QueryRunner`). O handler cria um
   produto; o teste, **assim que a resposta HTTP chega**, lê pelo `adminQuery()`. Se a linha ainda
   não está visível ⇒ o commit acontece depois da resposta (F16 confirmado).
3. **RLS:** a empresa A não lê produtos da B pelo `appDataSource()`; `FORCE` vale mesmo para o dono
   (regressão da base multi-tenant que tudo o mais assume).

**Correção condicional do F16** (só se o teste 2 falhar): `TenantContextMiddleware` passa a envolver
`res.end` — finaliza a transação (commit se `statusCode < 400`, senão rollback) **antes** de chamar o
`end` original; falha de commit vira 500. Cobre `res.send`/`res.json`/download de xlsx.

**Pronto quando:** `npm run test:int` roda do zero (cria banco, migra, testa), `npm test` segue verde
com 94 testes (94 = baseline original; após a etapa 1.1 são 106, com os testes do harness), e os três
testes de caracterização estão escritos com o resultado documentado.

**Resultados (etapa 1.1 executada em 2026-09-21):**
- **F5 confirmado** — `updated-at-semantics.int-spec.ts`: `updatedAt` é exatamente o `now()` da transação (início da transação, não o commit). O teste compara, com exatidão de microssegundos, `EXTRACT(EPOCH FROM "updatedAt")::text` com o `now()` capturado dentro da transação depois de `pg_sleep(1.1)`, e ainda faz a checagem grosseira de idade (observada: 1,16 s) e confere que a gravação de fato alterou `updatedAt`. (Uma primeira versão do teste não distinguia "atualizado no início da transação" de "nunca atualizado", porque o driver `pg` trunca para milissegundos; a revisão pegou isso e o teste foi reforçado e provado por mutação.) A sobreposição de 2 min do sync (etapa 1.4) está justificada.
- **F16 confirmado e corrigido** — `tenant-context.middleware.int-spec.ts`: com commit de 300 ms, a resposta chegava antes da gravação; e uma falha de commit era engolida (cliente recebia 201 sem dado gravado). `TenantContextMiddleware` agora finaliza a transação em `res.end`, antes de entregar a resposta; falha de commit vira 500; rollback em status ≥ 400 preservado. Endurecimento da revisão: `end` é idempotente (só a primeira chamada vale) e `res.headersSent` passa a valer `true` assim que o fim da resposta é pedido, para que a proteção contra resposta dupla do filtro de exceções do Nest continue funcionando (sem isso, um segundo `end` com corpo gerava `ERR_STREAM_WRITE_AFTER_END` não capturado e uma resposta pendente corrompida) — coberto pelo teste de regressão `POST /double`.
- **F18 confirmado** — `rls-isolation.int-spec.ts`, teste "conexão reutilizada": em conexão reutilizada `current_setting('app.current_company_id', true)` devolve `''` (não `NULL`) e o cast `''::uuid` das políticas falha com `QueryFailedError: invalid input syntax for type uuid: ""` para requisições sem tenant (ex.: `master_admin`). O teste do comportamento desejado está marcado `it.failing`, e um teste irmão, normal, fixa o modo de falha atual (`rejects.toThrow(/invalid input syntax for type uuid/)`). Nada foi corrigido. **Decisão pendente do usuário:** recriar as políticas com `NULLIF(current_setting('app.current_company_id', true), '')::uuid` (inclusive o ramo `… IS NULL` da política de `users`, que também precisa de `NULLIF(current_setting('app.current_company_id', true), '') IS NULL`; senão, com o `''` da conexão reutilizada, `'' IS NULL` é falso e as linhas do `master_admin` — `companyId` NULL — ficam invisíveis em vez de dar erro) (uma migration nova; afeta `users`, `products`, `losses`, `loss_reasons`, `loss_locations`, `import_jobs`, `company_monthly_revenue` e as tabelas novas do SP1).
- **Contagens finais:** `npm test` = 17 suítes / 106 testes; `npm run test:int` = 4 arquivos / 14 testes (2 de ciclo de vida do harness + 6 de RLS + 1 de F5 + 5 do middleware); `tsc --noEmit` limpo.

**Pendências levadas para as etapas seguintes (revisão final da etapa 1.1, 2026-09-21):**
- **F18 — decidido pelo usuário em 2026-09-21: entra já na etapa 1.2.** A migration que reescreve as
  políticas de RLS com `NULLIF(current_setting('app.current_company_id', true), '')::uuid` (incluindo o
  ramo `… IS NULL` da política de `users`) é a **primeira tarefa** do plano da etapa 1.2, antes das
  tabelas novas de valor congelado/histórico de preço — as tabelas novas herdariam o mesmo bug se
  copiassem o molde de política atual. Quando entrar, apagar o teste irmão e voltar o `it.failing` para
  `it()` em `rls-isolation.int-spec.ts`.
- **Robustez do middleware (tarefa da etapa 1.2):** `res.once('close')` como fallback de liberação do `queryRunner` (cliente que aborta antes da resposta), `connect()/startTransaction()` dentro do `try` com `release()` no `catch`, e um teste de integração sobre uma app Nest real (filtro de exceções + a rota `@Res()` do export xlsx), não só Express puro. No ramo de falha de commit, limpar também `Content-Disposition` do 500 (o export xlsx faria o navegador baixar o JSON de erro).
- **Streaming (etapa 1.3):** o ramo `headersSent` na falha de commit devolve sucesso truncado; deixa de ser inalcançável na primeira rota com `res.write`/stream (ex.: exportação grande) — tratar antes de criar uma.
- **Antes de a 1.2 criar tabelas:** módulo único de entidades (`src/database/entities.ts`) consumido por `app.module.ts`, `data-source.ts` (defasado) e `test-db.ts`; asserir `rolsuper=false`/`rolbypassrls=false` do `inventory_saas_test_owner` (um role pré-existente com BYPASSRLS deixaria os testes de RLS verdes sem proteger nada); controle positivo no teste de `WITH CHECK` (a empresa A consegue gravar em nome dela) e cobertura de `getTenantManager()` dentro de `withTenant`; `queryWith` assertar `credentials.database`.
- **Empacotamento:** `tsconfig.build.json` excluindo `**/*spec.ts` e `src/test-utils/**` do `dist`/imagem de produção; declarar `express` em `devDependencies` (o teste do middleware o importa direto; hoje funciona por hoisting).
- **CI / banco gerenciado:** trava real contra `test:int` concorrente (advisory lock no `globalSetup` ou nome de banco por execução); runbook: a extensão `pgcrypto` precisa existir antes da primeira migration em Postgres gerenciado (o harness a pré-cria como superusuário).
- **Processo:** planos das etapas 1.2–1.4 devem preferir "verde / baseline + N novos" a contagens absolutas de testes.

---

## 4. Etapa 1.2 — Valor congelado, histórico de preço e correção do F18

**Decisão do usuário (2026-09-21):** a correção do F18 entra nesta etapa, como a primeira sub-etapa —
antes de criar as tabelas novas, que herdariam o mesmo bug se copiassem o molde de política atual.

| Sub-etapa | Nome | Migration(s) | Depende de |
|---|---|---|---|
| **1.2.1** | Correção do F18 + hardening do harness (pré-requisito da 1.1) | `1700000010000-RlsReusedConnectionFix` | etapa 1.1 |
| **1.2.2** | Histórico de preço + valor congelado da perda (migrations e trigger) | `1700000011000-ProductPriceHistory`, `1700000012000-LossValuationSnapshot` | 1.2.1 |
| **1.2.3** | Backend: `resolveLossValuation`, `LossesService`, troca da base de cálculo nas consultas | — | 1.2.2 |
| **1.2.4** | Web: linha do tempo de preços no diálogo de produto | — | 1.2.3 |

Cada sub-etapa termina com testes verdes (unitários + integração) antes da seguinte, como na etapa 1.1.

### 4.0 Sub-etapa 1.2.1 — Correção do F18 e hardening do harness

**Por quê primeiro:** o F18 (RLS falha em conexão reaproveitada do pool) afeta **toda** tabela protegida
por RLS, inclusive as que a 1.2.2 ainda vai criar; e os itens de hardening do harness (ver "Pendências"
da etapa 1.1, acima) previnem que os testes de RLS das tabelas novas fiquem verdes sem proteger nada.

**4.0.1 Migration `1700000010000-RlsReusedConnectionFix`**

Reescreve as 7 políticas de RLS existentes trocando `current_setting('app.current_company_id', true)` por
`NULLIF(current_setting('app.current_company_id', true), '')` **antes** do cast `::uuid`. Alcança:
`tenant_isolation_users` (com o ramo `… IS NULL`, que também precisa do `NULLIF`, senão as linhas do
`master_admin` — `companyId` NULL — ficam invisíveis em vez de dar erro), `tenant_isolation_products`,
`tenant_isolation_losses`, `tenant_isolation_import_jobs`, `tenant_isolation_loss_reasons`,
`tenant_isolation_loss_locations`, `tenant_isolation_company_monthly_revenue` (confirmado por grep em
todas as migrations que definem política — não há nenhuma outra). `down()` restaura o comportamento
original (com o bug), mesmo padrão de "melhor esforço" já usado nas migrations deste projeto.

Não cria tabela nem mexe em `GRANT`/`FORCE` — só troca a expressão das 7 políticas já existentes.

**4.0.2 Hardening do harness (pendências da etapa 1.1)**
- Módulo único de entidades `src/database/entities.ts`, exportando o array hoje duplicado em
  `app.module.ts` (fonte da verdade, 8 entidades) e `data-source.ts` (defasado, falta
  `CompanyMonthlyRevenue`); `src/test-utils/test-db.ts` (`TEST_ENTITIES`) passa a importar do mesmo lugar.
  Sem isso, a 1.2.2 criaria uma 4ª cópia e a lista divergiria mais cedo ou mais tarde.
- `test-db-lifecycle.int-spec.ts`: asserir `rolsuper = false` e `rolbypassrls = false` (via `pg_roles`)
  tanto do dono (`inventory_saas_test_owner`) quanto do role de runtime (`inventory_saas_app`). Hoje o
  teste só confere o nome do dono e `relforcerowsecurity`; um role pré-existente criado com `BYPASSRLS`
  deixaria **todos** os testes de RLS verdes sem proteger nada.
- `rls-isolation.int-spec.ts`: controle positivo no teste de `WITH CHECK` — a empresa A **consegue**
  gravar um produto em nome dela mesma (hoje só se testa que falha em nome da B); sem o controle
  positivo, uma política quebrada por outro motivo (ex.: falta de `GRANT INSERT`) também faria o teste
  "passar" pela razão errada.
- `test-db.ts`: pelo menos um teste que exercita `getTenantManager()` **dentro** de `withTenant` (hoje
  nenhum teste do harness lê o manager via `tenantStorage`, só recebe o `manager` do callback).
- `test-db-lifecycle.ts`: `queryWith` passa a assertar `credentials.database` (não só `cfg.database`,
  que hoje são sempre idênticos, mas a asserção vira teatro se algum dia divergirem).
- **Un-skip do F18:** depois da migration, em `rls-isolation.int-spec.ts` apagar o teste irmão
  (`it('F18 (estado atual): …')`) e voltar o `it.failing('conexão reutilizada: …')` para `it(...)` — ele
  deve passar de verdade agora.

**Testes (TDD):**
- Integração: `it.failing` vira `it()` e passa; requisição sem tenant (`master_admin`) numa conexão que
  já serviu outro tenant não lança mais `invalid input syntax for type uuid`; `users` com `companyId
  NULL` continua visível só para sessão sem tenant, mesmo em conexão reaproveitada (regressão do ramo
  `IS NULL`); `rolsuper`/`rolbypassrls` do dono e do role de runtime; controle positivo do `WITH CHECK`.
- **Regra do módulo de entidades:** teste (unitário ou de integração leve) que falha se `app.module.ts`,
  `data-source.ts` e `test-db.ts` não importarem do mesmo array — evita que a duplicação volte.

**Pronto quando:** o teste "conexão reutilizada" do F18 passa como `it()` normal (sem `it.failing`); as
três entidades duplicadas viram uma só; e os testes de RLS não ficam mais verdes "pela razão errada".

---

### 4.1 Migrations (sub-etapa 1.2.2)

**`1700000011000-ProductPriceHistory`**
```sql
CREATE TABLE "product_price_history" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "seq"             bigint GENERATED ALWAYS AS IDENTITY,          -- desempate determinístico
  "companyId"       uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "productId"       uuid NOT NULL REFERENCES "products"("id")  ON DELETE CASCADE,
  "unitPrice"       numeric(12,2) NOT NULL,
  "costPrice"       numeric(12,2) NOT NULL,
  "validFrom"       timestamptz   NOT NULL,
  "changedByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
  "source"          varchar(20) NOT NULL DEFAULT 'manual'
                    CHECK ("source" IN ('manual','import','bulk','retro_fix','erp','approval')),
  "createdAt"       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX "idx_price_history_product_valid"
  ON "product_price_history" ("productId", "validFrom" DESC, "seq" DESC);
-- RLS: ENABLE + FORCE + política tenant_isolation_product_price_history — USING/WITH CHECK com
-- "companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid (mesma correção
-- do F18 aplicada em 1700000010000-RlsReusedConnectionFix na sub-etapa 1.2.1; NÃO copiar o padrão
-- antigo current_setting(...)::uuid sem o NULLIF das migrations anteriores a essa correção)
-- GRANT SELECT, INSERT (append-only) ao role inventory_saas_app, se existir.
```
- Função + trigger em `products`:
  `AFTER INSERT OR UPDATE OF "unitPrice","costPrice"` → insere a linha **somente se** `TG_OP='INSERT'`
  ou `IS DISTINCT FROM` no preço/custo; `validFrom = clock_timestamp()`; `changedByUserId =
  NULLIF(current_setting('app.current_user_id', true),'')::uuid`; `source =
  COALESCE(NULLIF(current_setting('app.change_source', true),''), 'manual')`.
- **Backfill:** uma linha por produto existente com `validFrom = products."createdAt"` e os valores
  **atuais** (o passado real é irrecuperável). Executado dentro do padrão de backfill sob FORCE RLS (RK1).

**`1700000012000-LossValuationSnapshot`**
```sql
ALTER TABLE "losses"
  ADD COLUMN "unitPriceAtLoss" numeric(12,2),
  ADD COLUMN "unitCostAtLoss"  numeric(12,2),
  ADD COLUMN "valuationSource" varchar(20);
-- backfill (padrão RK1): valores atuais do produto, valuationSource = 'backfill_current'
ALTER TABLE "losses"
  ALTER COLUMN "unitPriceAtLoss" SET NOT NULL,
  ALTER COLUMN "unitCostAtLoss"  SET NOT NULL,
  ALTER COLUMN "valuationSource" SET NOT NULL,
  ALTER COLUMN "valuationSource" SET DEFAULT 'snapshot',
  ADD CONSTRAINT "chk_losses_valuation_source" CHECK ("valuationSource" IN
    ('snapshot','backfill_current','fallback_current','recalculated','pending_product'));
-- BEFORE INSERT: se unitPriceAtLoss/unitCostAtLoss vierem NULL, preenche com o preço atual do
-- produto e força valuationSource = 'fallback_current'.
```
Ordem: o `NOT NULL` é verificado **depois** dos triggers `BEFORE`, então o trigger de segurança consegue
preencher. Fora de um contexto de tenant o `SELECT` do trigger não enxerga o produto (RLS) e o `INSERT`
falha alto — comportamento desejado.

### 4.2 Backend (sub-etapa 1.2.3)

- **Entidades:** `ProductPriceHistory` (nova; registrar em `src/database/entities.ts` — lista única
  consumida por `app.module.ts`, `data-source.ts` e `test-utils/test-db.ts` desde a sub-etapa 1.2.1);
  `Loss` ganha `unitPriceAtLoss`, `unitCostAtLoss`, `valuationSource` (união TS dos 5 valores).
- **`losses-valuation.ts`** (novo):
  `resolveLossValuation(manager, product, occurredAt)` → `{ unitPrice, unitCost, source }`:
  1. última linha do histórico com `validFrom <= occurredAt` (`ORDER BY validFrom DESC, seq DESC`);
  2. senão, a **mais antiga** (relógio do aparelho atrás da criação do produto) — `snapshot`;
  3. senão (produto sem histórico, não deveria ocorrer após o backfill) — preço atual, `fallback_current`.
  Também exporta as expressões SQL compartilhadas (`LOSS_REVENUE_SQL`, `LOSS_COST_SQL`) para não
  repetir a fórmula em 8 consultas.
- **`LossesService.create`:** resolve o valor com `occurredAt` (não com "agora"); grava os 3 campos.
  **`update`:** só recalcula se `productId` **ou** `occurredAt` mudarem (quantidade/descrição não mexem
  no preço congelado).
- **Trocar a base de cálculo** em todas as consultas que somam valor:
  `losses.service.ts` linhas 132, 133, 200, 201, 225, 243, 265, 303 (export), 442;
  `losses-suspicious-patterns.ts` linhas 56, 96, 140; `losses-alerts.ts` linhas 73 e ~360 (regra de
  "preço zero" passa a olhar o valor congelado). `top produtos` continua juntando `products` só para o
  **nome**. Os formatos de resposta **não mudam** (`totalFinancialLoss`, `totalCostLoss`…), então o
  painel não precisa de alteração.
- **Middleware:** `TenantContextMiddleware` também define `app.current_user_id` (e `withTenant` do
  harness idem). **Importação atual** (`imports.processor.ts`): `set_config('app.change_source',
  'import', true)` no início da transação — o trigger cuida do resto.
- **Endpoint novo (útil já nesta etapa):** `GET /products/:id/price-history` (gerente) → últimas 100
  linhas, mais recente primeiro.

**Resultados (sub-etapa 1.2.3, executada em 2026-09-23):** `resolveLossValuation` + constantes SQL em
`losses-valuation.ts`; `LossesService.create/update` gravam o valor congelado (update só recalcula se
produto ou data mudarem de VALOR); relatórios, export, alertas e padrões suspeitos usam
`loss.unitPriceAtLoss`/`unitCostAtLoss`; `app.current_user_id` no middleware e `app.change_source =
'import'` na importação; `GET /products/:id/price-history`. Migration `1700000013000` endureceu os
triggers (usuário inexistente → NULL, fallback parcial por coluna, `search_path` fixo). Regressão F1
coberta por `losses-f1-regression.int-spec.ts`. **Deploy:** aplicar 10000–13000 no banco real em janela
de manutenção — os `ALTER TABLE` da 11000/12000 tomam `ACCESS EXCLUSIVE` em `products`/`losses` até o
commit, e o backfill da 12000 reescreve todas as perdas.

### 4.3 Web (mínimo, sub-etapa 1.2.4)
- Diálogo de edição do produto ganha a linha do tempo de preços (lista simples: data, preço, custo,
  quem alterou, origem). Nenhuma outra tela muda.

### 4.4 Testes (sub-etapas 1.2.2–1.2.3, TDD — escrever primeiro e ver falhar)

Unitários (`*.spec.ts`, `manager` mockado, no estilo atual):
- `resolveLossValuation`: preço vigente na data; data anterior à 1ª linha usa a mais antiga; sem
  histórico usa o atual com `fallback_current`; desempate por `seq`.
- `LossesService.create` usa `occurredAt` (perda de ontem sincronizada hoje com preço alterado no meio
  vale o preço de ontem); `update` só recalcula ao mudar produto/data.
- Funções puras `losses-alerts`/`losses-suspicious-patterns`: specs reescritos para montar `Loss` com
  `unitPriceAtLoss` (mesma cobertura de hoje).

Integração (`*.int-spec.ts`, Postgres real, role de runtime):
- **Trigger de histórico:** criar produto gera 1 linha; mudar preço gera outra; regravar o mesmo valor
  **não** gera; `source`/`changedByUserId` vêm das variáveis de sessão; RLS isola empresas.
- **Backfill:** migrar até 10000 (inclui a correção do F18 da sub-etapa 1.2.1), semear produtos e perdas
  legados como superusuário, rodar 11000/12000 como dono não superusuário; toda perda ganha snapshot
  `backfill_current` com o preço atual; todo produto ganha 1 linha de histórico. (Falha se o padrão RK1
  não funcionar.)
- **Trigger de segurança:** `INSERT` de perda sem os campos ⇒ `fallback_current` com o preço atual;
  fora de tenant ⇒ erro.
- **Regressão F1 ponta a ponta:** registrar perda, mudar o preço do produto, `reportSummary`/
  `reportByProduct`/export **não** mudam o valor da perda antiga.
- **Exclusão de empresa (Painel Master):** o histórico tem `GRANT` só de `SELECT, INSERT` (append-only);
  o teste garante que `companies.remove()` continua apagando tudo em cascata (as ações de FK rodam com
  os privilégios do dono da tabela, mas isso é comportamento do Postgres que vale provar, não supor).

**Pronto quando:** alterar o preço de um produto não altera nenhum valor de perda anterior em nenhum
relatório, alerta, score nem export; perdas antigas continuam somando (com `backfill_current`).

---

## 5. Etapa 1.3 — Ciclo de vida do produto e busca no servidor

### 5.1 Contratos (todos aditivos — A5)

| Endpoint | Papel | Contrato |
|---|---|---|
| `POST /products` | gerente | conflito ⇒ `409 { statusCode, errorCode, message, productId? }`; `errorCode` = `PRODUCT_BARCODE_EXISTS` (ativo) ou `PRODUCT_ARCHIVED_EXISTS` (arquivado, com `productId`) |
| `PATCH /products/:id/restore` | gerente | reativa (`isActive = true`), devolve o produto |
| `DELETE /products/:id` | gerente | inalterado (204): **arquiva** |
| `GET /products/search` | gerente | `?q=&status=active|archived|all&page=&pageSize=&sort=name|updatedAt` → `{ items, total, page, pageSize }`; padrão `status=active`, `pageSize` 20 (máx. 100); `q` procura em nome (`ILIKE`), prefixo do código de barras e SKU, escapando `%`, `_`, `\` |
| `GET /products/barcode/:barcode` | gerente/funcionário | só **ativos** |
| `GET /products` (sync) | gerente/funcionário | **inalterado nesta etapa**; ganha parâmetros na 1.4 |

- `PATCH /products/:id` continua permitido para arquivados (o fluxo "reativar e atualizar" usa
  `restore` + `PATCH`).
- Rotas estáticas (`search`) declaradas **antes** de qualquer rota paramétrica.
- **Importação atual:** o upsert de produto existente passa a `isActive = true` (F2/F9c; o relatório de
  "reativados" fica para o SP3).

### 5.2 Web (`cadastros/produtos/page.tsx`)
- Lista passa a usar `products/search` com **debounce** de 300 ms, `page` e `total` do servidor
  (some o `filter` no navegador e o `paginate()` local).
- Abas **Ativos | Arquivados | Todos**; ação **Reativar** nos arquivados; "Excluir" vira **"Arquivar"**
  (texto do diálogo: o produto some do app dos funcionários, o histórico de perdas é mantido, dá para
  reativar).
- Cadastro que retorna `PRODUCT_ARCHIVED_EXISTS` mostra o aviso com o botão **"Reativar e atualizar
  os dados"** (`restore` + `PATCH` com o formulário).
- `lib/api-client.ts`: `ApiError` passa a carregar `errorCode` e `data` (hoje só `status` e `message`),
  nos dois caminhos (`request` e `requestForm`). `lib/types.ts`: tipo `ProductSearchResult`.
- Arquivos com mudanças não commitadas de outra frente (`types.ts`) recebem só acréscimos; nada é
  commitado sem pedido.

### 5.3 Testes
Unitários: `ProductsService.create` (ativo ⇒ `PRODUCT_BARCODE_EXISTS`; arquivado ⇒
`PRODUCT_ARCHIVED_EXISTS` com `productId`), `restore`, `findByBarcode` só ativos, montagem de filtros do
`search`; web (vitest + Testing Library, `api` mockado, no estilo de `conferencias-client.spec.tsx`):
abas trocam o parâmetro `status`, busca com debounce, reativar chama `PATCH …/restore`, conflito de
arquivado oferece a ação, texto "Arquivar".
Integração: `search` com escape de curinga (`%` não vira "tudo"), paginação/total corretos, status;
`restore` idempotente; RLS; **processador de importação** reativa arquivado e grava histórico com
`source='import'` (xlsx gerado por ExcelJS, `StorageService` falso).

**Medição (não vira teste permanente):** popular 100 mil produtos de uma empresa (`generate_series`) e
medir `search`; se passar de ~300 ms, `pg_trgm` entra como decisão D6 antes de fechar a etapa.

**Pronto quando:** arquivar → recadastrar o mesmo código oferece reativar; o painel lista 100 mil
produtos com busca e paginação no servidor; `findByBarcode` não devolve arquivado.

---

## 6. Etapa 1.4 — Sync correto e migração do SQLite

### 6.1 Backend (`GET /products`, retrocompatível)

| Parâmetro | Efeito |
|---|---|
| `since` | validado (`@IsDateString`; hoje um valor inválido vira `Invalid Date` ⇒ erro 500) |
| `includeArchived=true` | inclui `isActive=false` (tombstones) — **só o app novo envia** (R1) |
| `limit` | 1–10000; sem `limit` = comportamento atual (lista completa) |
| `after` | cursor de continuação `"<updatedAt µs ISO>\|<id>"` (R5) |

- Ordenação `(updatedAt ASC, id ASC)`; condição de continuação `(updatedAt, id) > (:afterAt::timestamptz,
  :afterId)`; o cursor é gerado no SQL com `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
- **Resposta continua sendo um array JSON.** Cabeçalhos novos (apps antigos os ignoram):
  `X-Sync-Cursor` = `now()` **do banco** no início da requisição (o mesmo relógio que grava `updatedAt`,
  não o do processo Node nem o do aparelho); `X-Next-After` só quando a página veio cheia (há mais).
- Índice novo: `(companyId, updatedAt, id)` em `products` (migration `1700000012000`).
- Importação atual: sem mudança de transação nesta etapa (a divisão em lotes de ~500 é do SP3); a
  **sobreposição no cliente** cobre o caso.

### 6.2 App (Flutter)
- `ApiClient` ganha um método que devolve **corpo + cabeçalhos** (o `get` atual só devolve o corpo).
- `ProductRepository.refreshFromServer()`:
  - **Primeira carga** (sem cursor): baixa **todas as páginas para a memória** e só então troca o
    catálogo de uma vez numa transação (hoje: `delete` + inserts em `batch`; falha no meio deixaria o
    aparelho sem catálogo offline).
  - **Incremental:** `since = cursor − 2 min`, `includeArchived=true`, `limit=5000`, segue `X-Next-After`;
    item com `isActive == false` ⇒ `DELETE` local; senão upsert.
  - Grava o cursor (`X-Sync-Cursor`) **só ao final, com tudo aplicado**. Servidor antigo (sem
    cabeçalho) ⇒ cai no relógio do aparelho como hoje.
- `AppDatabase`: `version: 2`, `onUpgrade` que percorre um mapa `_migrations[versão]`,
  **sempre aditivo**; `v2` = apaga `products_last_sync_at` (R6). Sem `onDowngrade` destrutivo (nunca
  apagar `losses`). Ponto de abertura injetável (`openAt(path)`) para teste.

### 6.3 Testes
Backend (integração): produtos com o **mesmo** `updatedAt` em quantidade maior que `limit` paginam sem
repetir nem perder (regressão do loop infinito, R5); `includeArchived` liga/desliga tombstones;
sem parâmetros novos a resposta é idêntica à de hoje; `since` inválido ⇒ 400; cabeçalhos presentes.
App (`flutter test`, `sqflite_common_ffi` já é dependência de desenvolvimento):
- migração v1→v2: abrir um banco v1 (esquema copiado para uma fixture) **com perda pendente** ⇒ perda
  intacta, cursor apagado;
- repositório com `ApiClient` falso: primeira carga em várias páginas com troca atômica (falha na 2ª
  página **não** altera o catálogo), incremental aplica tombstone (produto arquivado some), cursor só
  gravado no fim, servidor antigo sem cabeçalhos.

**Pronto quando:** arquivar no painel remove o produto do celular no próximo sync (inclusive
instalações antigas, via re-sync total do v2); relógio do aparelho errado não perde mudanças; nenhuma
perda pendente é apagada por atualização do app.

---

## 7. Riscos e mitigação

| ID | Risco | Mitigação |
|---|---|---|
| RK1 | **Backfill sob `FORCE ROW LEVEL SECURITY`.** Em bancos gerenciados o dono não é superusuário e `FORCE` vale para ele: um `UPDATE … FROM products` sem contexto de tenant altera **0 linhas** (ou falha no `WITH CHECK`). | Helper `withoutForcedRls(queryRunner, tabelas, fn)` em `src/database/helpers/rls.ts` (**fora** de `migrations/`, cujo *glob* carrega todo arquivo): `NO FORCE` → backfill → `FORCE`, dentro da transação da migration. Testado porque o harness migra como dono não superusuário (R8). |
| RK2 | Janela de deploy (migration antes do backend novo): o backend antigo insere perda sem os campos novos. | Trigger `BEFORE INSERT` preenche e marca `fallback_current` (R3). |
| RK3 | Loop de paginação com `updatedAt` idêntico. | Cursor com precisão total + desempate por `id` + teste de regressão (R5). |
| RK4 | Apps antigos tratando arquivado como ativo. | Tombstone opt-in (R1). |
| RK5 | Perder a fila de perdas do aparelho em migração. | `onUpgrade` só aditivo; sem `onDowngrade` destrutivo; teste v1→v2 com perda pendente. |
| RK6 | Rodar migrations/testes contra o banco de desenvolvimento (`inventory_saas`) por engano. | Trava `_test` no harness; **aplicar migrations no banco de desenvolvimento só com sua autorização explícita** ao fim do SP. |
| RK7 | `numeric(12,2)` truncar custo de item fracionado. | Aceito no SP1; o SP4 avalia `numeric(12,4)`. |
| RK8 | `updatedAt` = início da transação (F5) perder linha alterada durante o sync. | Confirmado por teste (1.1); sobreposição de 2 min; lotes no SP3. |
| RK9 | Mudanças não commitadas de outra frente em arquivos que este SP também toca (`web-panel/src/lib/types.ts`, `api-client.ts`). | Só acréscimos; sem commit sem pedido; ao commitar, separar por assunto. |

## 8. Ambiente e verificação

- Backend: `npm test` (baseline **17 suítes / 106 testes unitários**), `npm run test:int` (**14 testes de
  integração**) e `npx tsc --noEmit` (limpo) — baselines após a etapa 1.1.
- Web: `npx vitest run` (baseline 129 testes / 32 arquivos, segundo o histórico da frente anterior) e
  `npx tsc --noEmit`.
- App: `C:\flutter\bin\flutter test` (baseline 27 testes; o Flutter **não** está no PATH desta sessão) e
  `flutter analyze`.
- Postgres de teste: container existente `backend-postgres-1` (porta 5433). O banco de desenvolvimento
  **não** é tocado.
- Antes de declarar cada etapa pronta: `superpowers:verification-before-completion` (rodar tudo e citar
  a saída).

## 9. Definição de pronto do SP1

1. Mudar o preço de um produto **não** muda valor de perda passada (relatórios, alertas, score, export).
2. Arquivar → recadastrar o mesmo código oferece reativar; importação reativa.
3. Painel lista catálogos grandes com busca e paginação no servidor.
4. Arquivar no painel remove o produto do app no próximo sync, sem perder mudanças por relógio errado
   e sem apagar perdas pendentes.
5. Harness de integração documentado e rodando; testes de caracterização de F5/F16 registrados (e F16
   corrigido se confirmado).
6. Todas as suítes verdes (backend unitário + integração, web, app) e `tsc`/`analyze` limpos.

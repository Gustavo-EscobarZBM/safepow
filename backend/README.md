# Backend — Sistema de Controle de Perdas de Estoque (SaaS)

Implementa a Fase 1 e parte da Fase 2 do roteiro do documento de arquitetura:
banco de dados multi-tenant com Row Level Security, autenticação, licenciamento
(bloqueio remoto pelo Painel Master), catálogo de produtos e registro de perdas.

## Stack

NestJS + TypeScript, PostgreSQL (via TypeORM), Redis (reservado para as filas
de importação de planilha — Seção 5 do documento, ainda não implementadas),
JWT para autenticação.

## Como rodar localmente

Pré-requisito: Docker e Docker Compose instalados.

```bash
cp .env.example .env
# Ajuste os segredos em .env antes de qualquer uso além de desenvolvimento local.

docker compose up -d          # sobe Postgres, Redis e o backend
docker compose exec backend npm run migration:run   # cria as tabelas e a RLS
docker compose exec backend npm run seed            # cria o usuário master admin
```

A API fica disponível em `http://localhost:3000/api`.

### Rodando sem Docker (Node local)

```bash
npm install
cp .env.example .env   # aponte DB_HOST etc. para um Postgres já rodando
npm run migration:run
npm run seed
npm run start:dev
```

## Testando o fluxo básico

```bash
# 1) Login como master admin
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"master@seusistema.com.br","password":"troque-esta-senha"}'

# 2) Com o accessToken retornado, criar uma empresa cliente
curl -X POST http://localhost:3000/api/master/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_DO_MASTER>" \
  -d '{
    "name": "Mercado Exemplo Ltda",
    "managerName": "Maria Gerente",
    "managerEmail": "maria@mercadoexemplo.com.br",
    "managerPassword": "senha123"
  }'

# 3) Login como o gerente da empresa recém-criada
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@mercadoexemplo.com.br","password":"senha123"}'

# 4) Cadastrar um produto (com o token do gerente)
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_DA_MARIA>" \
  -d '{"barcode":"7891000100103","name":"Arroz 5kg","unitPrice":24.90}'

# 5) Bloquear a empresa pelo Painel Master (Seção 6.2) e confirmar que o gerente
#    perde acesso (deve retornar 402 SUBSCRIPTION_INACTIVE na próxima chamada)
curl -X PATCH http://localhost:3000/api/master/companies/<COMPANY_ID>/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_DO_MASTER>" \
  -d '{"status":"blocked"}'
```

## Decisões de arquitetura implementadas (e onde estão no código)

| Decisão do documento | Onde está no código |
|---|---|
| Banco único + `companyId` + RLS (Seção 1.2) | `src/database/migrations/1700000000000-InitialSchema.ts` |
| Role de runtime sem privilégio de dono (RLS não pode ser ignorada) | `docker/init-db/001-create-app-role.sql` |
| Contexto de tenant por requisição (`SET LOCAL`) | `src/common/tenant/tenant-context.middleware.ts` + `tenant-storage.ts` |
| Bloqueio remoto por inadimplência (Seção 6.2) | `src/common/guards/subscription.guard.ts` |
| Painel Master (Seção 6.1) | `src/modules/companies/*` |
| Idempotência para sincronização offline (Seção 4.2) | `src/modules/losses/losses.service.ts` (`clientGeneratedId`) |
| Base dos gráficos gerenciais (Seção 2, funcionalidade 2) | `LossesService.reportByProduct` |
| Sincronização incremental de catálogo (Seção 4.3) | `ProductsService.findAll(sinceIso)` — `GET /products?since=ISO` |
| Upload de imagem para object storage (Seção 2.3) | `src/modules/uploads/*` — `POST /uploads/loss-image` |
| Importação de planilha assíncrona (Seção 5.2) | `src/modules/imports/*` — fila BullMQ + worker `ImportsProcessor` |
| Mapeamento flexível de colunas (Seção 5.4) | `ColumnMappingDto` + `ImportsProcessor` |
| Exportação de planilha (Seção 5.3) | `LossesService.exportToXlsx` — `GET /losses/export` |
| Cobrança recorrente automatizada (Seção 6.3) | `src/modules/billing/billing.controller.ts` — webhook do Stripe |
| Gestão de usuários dentro do tenant | `src/modules/users/*` |

## Endpoints disponíveis

| Método | Rota | Papel exigido | Descrição |
|---|---|---|---|
| POST | `/api/auth/login` | — | Login |
| POST | `/api/master/companies` | master_admin | Cria empresa + gerente inicial |
| GET | `/api/master/companies` | master_admin | Lista empresas |
| PATCH | `/api/master/companies/:id/status` | master_admin | Bloqueia/reativa empresa |
| POST | `/api/products` | manager | Cadastra produto |
| GET | `/api/products?since=ISO` | manager, employee | Lista/sincroniza catálogo |
| GET | `/api/products/barcode/:barcode` | manager, employee | Busca por código de barras |
| POST | `/api/products/import` | manager | Sobe planilha (multipart: `file` + `mapping` JSON) |
| GET | `/api/products/import/:id` | manager | Status/relatório da importação |
| POST | `/api/losses` | employee, manager | Registra perda (idempotente) |
| GET | `/api/losses` | manager | Lista perdas |
| GET | `/api/losses/reports/by-product` | manager | Dados para os gráficos |
| GET | `/api/losses/export` | manager | Exporta perdas em .xlsx |
| POST | `/api/uploads/loss-image` | qualquer papel do tenant | Upload de foto (multipart: `file`) |
| POST | `/api/users` | manager | Convida funcionário/gerente |
| GET | `/api/users` | manager | Lista usuários do tenant |
| PATCH | `/api/users/:id/deactivate` \| `/reactivate` | manager | Ativa/desativa usuário |
| POST | `/api/billing/webhooks/stripe` | — (verificado por assinatura) | Webhook de cobrança |

## Testes automatizados

```bash
npm test
```

106 testes unitários em 17 suítes, cobrindo, entre outros: `RolesGuard`,
`SubscriptionGuard` (bloqueio por assinatura), validação do `CreateLossDto`,
`CompaniesService.updateStatus`, e — o mais importante — a **idempotência real
da sincronização offline** (`losses.service.spec.ts`), que exercita o
`AsyncLocalStorage` de contexto de tenant de verdade, não apenas mocks isolados.

São testes unitários (sem banco/Redis reais). Os testes de integração contra um
Postgres de verdade (RLS, triggers, migrations, middleware) existem e rodam com
`npm run test:int` — ver a seção **Testes**, ao final deste arquivo. Ainda não
há testes de integração contra Redis (fila de importação) nem E2E.

## O que ainda NÃO está implementado

- Fluxo de checkout/assinatura que preenche `Company.billingProviderCustomerId`
  (o webhook do Stripe já trata os eventos, mas falta a ponta que cria a
  assinatura no Stripe quando uma empresa contrata um plano).
- Rotina para promover `past_due` prolongado para `blocked` automaticamente
  (hoje isso fica a cargo de um segundo webhook do Stripe ou de ação manual
  pelo Painel Master).
- Testes de integração contra Redis (fila de importação BullMQ) e testes E2E.
  (Os testes de integração contra Postgres real já existem: ver a seção
  **Testes**, ao final.)
- Paginação nos endpoints de listagem (hoje `losses` limita a 500 registros;
  `products`, `users` e `master/companies` não paginam).

## Nota histórica sobre o ambiente onde este código foi gerado

Na primeira geração deste backend não havia PostgreSQL, Redis nem MinIO reais
no ambiente (sem Docker disponível, e o mirror de pacotes do Ubuntu necessário
para instalar Postgres via `apt` estava indisponível). Naquela época o código
foi validado só com `npx tsc --noEmit`, `npm run build`, `npm test` (incluindo um
teste que exercita o `AsyncLocalStorage` real do contexto de tenant) e o boot
da aplicação NestJS.

Isso mudou para tudo que depende do Postgres: a Row Level Security, o
`TenantContextMiddleware` (transação por requisição, com commit antes de a
resposta sair), as migrations e a semântica de `updatedAt` são cobertos por
testes de integração contra um Postgres real, com `npm run test:int` — ver a
seção **Testes**, ao final deste arquivo.

Continuam **sem** cobertura de integração: Redis/BullMQ (fila de importação),
uploads para MinIO/S3, cobrança (billing/Stripe) e testes E2E.

## Testes

- `npm test` — testes **unitários** (rápidos, sem Docker; `manager` mockado).
- `npm run test:int` — testes de **integração** contra Postgres real (RLS, triggers, migrations, middleware). Requer o Postgres do compose: `docker compose up -d postgres` (porta do host no `.env`, hoje 5433).

Os testes de integração usam **somente** o banco `inventory_saas_test`, recriado do zero a cada execução (dono `inventory_saas_test_owner`, **sem** superusuário, para que `FORCE ROW LEVEL SECURITY` valha como em bancos gerenciados; o role de runtime `inventory_saas_app` é quem executa as consultas). O banco de desenvolvimento **nunca** é tocado: o harness recusa qualquer nome que não termine em `_test` e não lê `DB_NAME` do `.env`.

Segurança do harness:

- O harness só aceita `DB_HOST` = `localhost`, `127.0.0.1` ou `::1`, a menos que `TEST_DB_ALLOW_REMOTE=1` esteja definido: o role de teste tem senha fixa e o harness apaga/cria bancos, então apontá-lo para um servidor remoto exige um opt-in explícito.
- `queryAsAdmin`/`queryAsOwner` conferem de novo, a cada chamada, que o nome do banco termina em `_test`.
- **Nunca rode `npm run test:int` duas vezes ao mesmo tempo:** o `globalSetup` recria o banco compartilhado `inventory_saas_test` a cada execução, e uma execução derruba o banco da outra.

Convenções:

- Arquivos de integração terminam em `.int-spec.ts` (com hífen; `.spec.ts` é unitário).
- Helpers em `src/test-utils/`: `withTenant()` (mesma mecânica do `TenantContextMiddleware`), `seedCompany()`, `seedProduct()`, `truncateAll()`, `adminQuery()` (superusuário, ignora RLS) e `ownerQuery()`. Todo arquivo que usa `appDataSource()` deve chamar `closeTestConnections()` no `afterAll`.
- Para testar um backfill, crie um banco próprio (`createTestDatabase(cfg, { migrateUpTo })`, nome terminando em `_test`), semeie dados "legados" como superusuário e aplique o restante com `runMigrations(cfg)`. Ver `src/test-utils/test-db-lifecycle.int-spec.ts`.

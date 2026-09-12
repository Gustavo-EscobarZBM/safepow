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

23 testes cobrindo: `RolesGuard`, `SubscriptionGuard` (bloqueio por assinatura),
validação do `CreateLossDto`, `CompaniesService.updateStatus`, e — o mais
importante — a **idempotência real da sincronização offline**
(`losses.service.spec.ts`), que exercita o `AsyncLocalStorage` de contexto de
tenant de verdade, não apenas mocks isolados.

São testes unitários (sem banco/Redis reais). Testes de integração contra um
Postgres/Redis de verdade são o próximo passo natural — não foi possível
rodá-los neste ambiente de desenvolvimento (ver nota abaixo).

## O que ainda NÃO está implementado

- Fluxo de checkout/assinatura que preenche `Company.billingProviderCustomerId`
  (o webhook do Stripe já trata os eventos, mas falta a ponta que cria a
  assinatura no Stripe quando uma empresa contrata um plano).
- Rotina para promover `past_due` prolongado para `blocked` automaticamente
  (hoje isso fica a cargo de um segundo webhook do Stripe ou de ação manual
  pelo Painel Master).
- Testes de integração (com banco/Redis reais) e testes E2E.
- Paginação nos endpoints de listagem (hoje `losses` limita a 500 registros;
  `products`, `users` e `master/companies` não paginam).

## Nota importante sobre o ambiente onde este código foi gerado

Não havia acesso a um PostgreSQL, Redis ou MinIO reais no ambiente em que este
backend foi desenvolvido (sem Docker disponível e o mirror de pacotes do
Ubuntu necessário para instalar Postgres via `apt` estava indisponível). O
código foi validado com:
- `npx tsc --noEmit` (zero erros de tipo, em todas as rodadas de desenvolvimento)
- `npm run build` (build de produção completo)
- `npm test` (23 testes unitários passando, incluindo um teste que exercita o
  `AsyncLocalStorage` real do contexto de tenant, não apenas mocks)
- Boot real da aplicação NestJS (toda a árvore de dependências/módulos sobe
  corretamente — incluindo BullMQ, uploads e billing — falhando apenas na
  conexão com Postgres/Redis, que não existem neste ambiente — esperado)

**Antes do primeiro uso real, rode `docker compose up` e siga o fluxo de teste
acima para validar o comportamento fim a fim com um banco de dados de verdade**,
principalmente a Row Level Security (é a parte mais sensível a erros sutis).

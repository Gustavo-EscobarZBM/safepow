# SP4 Etapa 4.1 — Novos dados do produto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produto ganha categoria (3 níveis), marca, fornecedor, unidade, custo com 4 casas, perecível/validade, foto e observações; perdas passam a ser analisadas por categoria e fornecedor; o app mostra foto e unidade.

**Architecture:** Uma migration cria `categories`/`brands`/`suppliers` (RLS + auditoria por trigger) e as colunas novas em `products`. Um módulo `catalog` no backend expõe as três taxonomias com o mesmo serviço genérico; produtos, importação/exportação, sync e relatórios passam a conhecer os campos. No painel, as telas novas usam os blocos do motor de cadastros (SP2 2.4); no app, SQLite v3.

**Tech Stack:** NestJS + TypeORM + Postgres 16 (Jest unit/int), Next.js + Tailwind + shadcn/ui (Vitest), Flutter/sqflite.

**Spec:** `docs/superpowers/specs/2026-09-28-sp4-produtos-2-0-design.md` (seção 3; decisões P1–P9).

## Global Constraints

- Migration nova: `backend/src/database/migrations/1700000020000-ProductCatalogData.ts` (única desta etapa).
- Toda tabela nova: `ENABLE` + `FORCE ROW LEVEL SECURITY`, política com `TENANT_COMPANY_ID_PREDICATE` de `src/database/helpers/rls.ts`, grant ao role `inventory_saas_app` no bloco `DO $$ … IF EXISTS … $$` (padrão da 17000), trigger `audit_row_change` (padrão da 16000).
- Entidade nova só entra em `backend/src/database/entities.ts` (`ENTITIES`).
- Unidades: exatamente `UN, KG, G, L, ML, CX, PCT, DZ, M`; padrão `UN`. Unidades fracionáveis (quantidade com decimais): `KG, G, L, ML, M`.
- Categoria: no máximo **3 níveis**; nome até 80; marca até 80; fornecedor até 120; `taxId` até 18.
- `costPrice` (produtos e histórico de preço) e `losses."unitCostAtLoss"` → `numeric(12,4)`; `unitPrice` continua `numeric(12,2)`.
- Sem NCM (P2). Sem dependência nova de runtime (redimensionar foto com `<canvas>`; app já tem `image_picker`).
- Escrita (criar/editar/arquivar) só `UserRole.MANAGER`; leitura das taxonomias também para `EMPLOYEE`.
- Mensagens de erro e textos de tela em português.
- Nunca `git add -A` na raiz (`.superpowers/` não está no .gitignore); commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm run test:int` nunca em paralelo com outra execução. Migrations no banco `inventory_saas` só na Task 10, com `pg_dump` antes.
- Branch: `feat/cadastros-sp4-etapa-4-1` a partir de `main`.

## Review Focus

1. **Categoria/marca/fornecedor arquivado ainda ligado a produtos** — o produto mantém o vínculo e a tela mostra "(arquivada)"; tentar **definir** um arquivado num produto dá 400. → testes na Task 3.
2. **Mover categoria para dentro dela mesma ou de uma descendente / passar de 3 níveis** — 400 com mensagem clara, nada gravado. → teste na Task 1 (trigger) e Task 2 (HTTP).
3. **Importação com "bebidas" quando existe "Bebidas"** — reaproveita a existente (comparação sem diferenciar maiúsculas), não cria duplicada; custo "3,1234" é gravado com 4 casas. → testes na Task 4.
4. **Unidade UN com quantidade fracionada no app** — o campo continua só inteiro para UN/CX/PCT/DZ; KG aceita 0,850. → teste na Task 9.
5. **Foto grande/formato não suportado (HEIC, > 8 MB)** — mensagem amigável, produto salvo sem foto se o usuário desistir. → testes na Task 3 (backend) e Task 7 (painel).

---

### Task 1: Migration e entidades (taxonomias + colunas do produto)

**Files:**
- Create: `backend/src/database/migrations/1700000020000-ProductCatalogData.ts`
- Create: `backend/src/modules/catalog/category.entity.ts`, `brand.entity.ts`, `supplier.entity.ts`
- Modify: `backend/src/modules/products/product.entity.ts`, `backend/src/modules/losses/loss.entity.ts` (escala do custo), `backend/src/modules/products/product-price-history.entity.ts`, `backend/src/database/entities.ts`
- Test: `backend/src/database/product-catalog-data.int-spec.ts`

**Interfaces:**
- Produces: tabelas `categories(id, companyId, name, parentId, isActive, createdAt, updatedAt)`, `brands(id, companyId, name, isActive, …)`, `suppliers(id, companyId, name, taxId, contactName, phone, email, notes, isActive, …)`; `products.categoryId|brandId|supplierId` (uuid null, FK `ON DELETE RESTRICT`), `unit varchar(4) NOT NULL DEFAULT 'UN'`, `isPerishable boolean NOT NULL DEFAULT false`, `shelfLifeDays int NULL CHECK (> 0)`, `imageUrl varchar(500) NULL`, `notes text NULL`, `reviewStatus varchar(10) NOT NULL DEFAULT 'approved' CHECK IN ('approved','pending')`. Entidades `Category`, `Brand`, `Supplier`; `ProductUnit` = union/const `PRODUCT_UNITS` exportado de `product.entity.ts`, e `FRACTIONAL_UNITS = ['KG','G','L','ML','M']`.
- Índices únicos: `uq_categories_company_parent_name` em `("companyId", COALESCE("parentId", '00000000-0000-0000-0000-000000000000'::uuid), lower(name))`; `uq_brands_company_name` e `uq_suppliers_company_name` em `("companyId", lower(name))`. Índices de FK em `products(categoryId)`, `(brandId)`, `(supplierId)`.
- Trigger `categories_check_tree` (BEFORE INSERT OR UPDATE OF "parentId"): pai precisa ser da mesma empresa; recusa ciclo; recusa profundidade > 3 **considerando as descendentes** da categoria movida. Erro com `ERRCODE = 'check_violation'` e mensagem `categoria: …` (a Task 2 traduz para 400).
- Auditoria: `trg_audit_categories` (`'category'`), `trg_audit_brands` (`'brand'`), `trg_audit_suppliers` (`'supplier'`).

- [ ] **Step 1: Write the failing tests** em `product-catalog-data.int-spec.ts` (padrão de `approval-requests.int-spec.ts`):
  - `unique category name per parent ignores case and treats null parent as one group` — duas raízes "Bebidas"/"bebidas" na mesma empresa → erro 23505; mesma "Bebidas" como filha de pais diferentes → ok.
  - `rejects a 4th category level and a cycle` — A›B›C ok; D filha de C → erro; mover A para filha de C → erro; mover uma raiz com 2 níveis abaixo para dentro de outra raiz → erro (seria nível 4).
  - `rls isolates categories, brands and suppliers` — contexto da empresa X não enxerga linhas da empresa Y.
  - `products get new columns with defaults and cost keeps 4 decimals` — produto antigo: `unit = 'UN'`, `isPerishable = false`, `reviewStatus = 'approved'`; `UPDATE products SET "costPrice" = 3.1234` lê `3.1234`; `losses."unitCostAtLoss"` aceita `3.1234`; `product_price_history."costPrice"` idem.
  - `rejects unknown unit` — `unit = 'XX'` → erro 23514.
  - `audits category insert` — insert gera linha em `audit_log` com `entityType = 'category'`.
- [ ] **Step 2: Run** `cd backend && npm run test:int -- product-catalog-data` → FAIL (tabelas não existem).
- [ ] **Step 3: Implement** a migration (up e down completos; `ALTER COLUMN … TYPE numeric(12,4)` nas 3 colunas de custo) e as entidades.
- [ ] **Step 4: Run** o mesmo comando → PASS; depois `npm test -- entities` → PASS; `npx tsc --noEmit -p tsconfig.json` limpo.
- [ ] **Step 5: Commit** `feat(catalog): tabelas de categorias, marcas e fornecedores e novos campos do produto`.

### Task 2: API das taxonomias (categorias, marcas, fornecedores)

**Files:**
- Create: `backend/src/modules/catalog/catalog-taxonomy.service.ts`, `categories.controller.ts`, `brands.controller.ts`, `suppliers.controller.ts`, `catalog.module.ts`, `dto/*.ts`, `catalog.export-handlers.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/modules/catalog/catalog.http.int-spec.ts`

**Interfaces:**
- Consumes: entidades da Task 1.
- Produces (as três rotas `categories`, `brands`, `suppliers`, mesmo formato):
  - `GET /<r>?includeArchived=true` (MANAGER, EMPLOYEE) → lista ordenada por nome; categoria traz `parentId` e `path` (`"Mercearia > Bebidas"`).
  - `POST /<r>` → 201; nome repetido (sem diferenciar maiúsculas; na categoria, dentro do mesmo pai) → 409 `Já existe … com este nome.`
  - `PATCH /<r>/:id` → 200 (categoria aceita `parentId`; erro do trigger → 400 com a mensagem).
  - `POST /<r>/:id/archive` → 200; categoria com filhas ativas → 409 `Arquive primeiro as subcategorias.` Arquivar **não** mexe nos produtos.
  - `POST /<r>/:id/restore` → 200; categoria cujo pai está arquivado → 409.
  - `GET /<r>/export?format=xlsx|csv` → streaming via `streamExport` (colunas: categorias `Caminho, Situação`; marcas `Nome, Situação`; fornecedores `Nome, CNPJ/CPF, Contato, Telefone, E-mail, Observações, Situação`).
  - `class CatalogTaxonomyService<T extends { id: string; name: string; isActive: boolean }>` com `list(includeArchived)`, `create(data)`, `update(id, data)`, `archive(id)`, `restore(id)`; instâncias para marca e fornecedor; `CategoriesService` estende e acrescenta `path` e as regras de árvore.
  - Função exportada `categoryPathMap(manager): Promise<Map<string, string>>` (id → caminho) — usada nas Tasks 3, 4 e 5.

- [ ] **Step 1: Write the failing tests** (`catalog.http.int-spec.ts`, app de teste no padrão de `approval-policies.http.int-spec.ts`): CRUD feliz das três; 409 de nome repetido com outra caixa; categoria nível 4 → 400; arquivar pai com filha ativa → 409; restaurar filha com pai arquivado → 409; EMPLOYEE faz `GET` (200) e `POST` (403); `GET /categories` devolve `path`; export devolve cabeçalhos acima.
- [ ] **Step 2: Run** `npm run test:int -- catalog.http` → FAIL.
- [ ] **Step 3: Implement** o módulo.
- [ ] **Step 4: Run** → PASS; `npm test` sem regressão.
- [ ] **Step 5: Commit** `feat(catalog): API de categorias, marcas e fornecedores`.

### Task 3: Produto com os campos novos, filtros, sync e foto

**Files:**
- Modify: `backend/src/modules/products/dto/create-product.dto.ts`, `update-product.dto.ts`, `search-products.dto.ts`, `products.service.ts`, `products-search.ts`, `products-sync.ts` (payload), `backend/src/modules/uploads/uploads.controller.ts`
- Test: `backend/src/modules/products/products-catalog-fields.http.int-spec.ts`, `backend/src/modules/uploads/uploads.http.int-spec.ts` (criar se não existir)

**Interfaces:**
- Consumes: `categoryPathMap` (Task 2), `PRODUCT_UNITS` (Task 1).
- Produces:
  - DTOs aceitam `categoryId?, brandId?, supplierId?` (uuid ou `null` para limpar), `unit?` (`IsIn(PRODUCT_UNITS)`), `isPerishable?`, `shelfLifeDays?` (int ≥ 1 ou null), `imageUrl?` (string até 500 ou null), `notes?` (até 2000), `costPrice` com até 4 casas.
  - Definir id inexistente ou **arquivado** → 400 `Categoria inválida ou arquivada.` (idem marca/fornecedor). Manter um já ligado que depois foi arquivado → permitido.
  - Respostas de produto (lista, busca, detalhe) trazem `categoryId, categoryPath, brandId, brandName, supplierId, supplierName, unit, isPerishable, shelfLifeDays, imageUrl, notes`.
  - Busca/lista aceita `categoryId` (inclui descendentes), `brandId`, `supplierId`, `unit`.
  - Sync (`findForSync`) acrescenta `unit`, `imageUrl`, `isPerishable` a cada item.
  - `POST /uploads/product-image` (MANAGER): mesmas regras de `loss-image` (JPEG/PNG/WebP, 8 MB), pasta `products` → `{ url }`.

- [ ] **Step 1: Write the failing tests**: criar produto com todos os campos e ler de volta (inclui `categoryPath`); definir categoria arquivada → 400; produto com categoria arquivada depois continua editável sem trocar a categoria; filtro por categoria raiz traz produtos das filhas; `unit: 'XX'` → 400; custo `3.1234` volta `3.1234`; sync traz `unit/imageUrl/isPerishable`; upload de `image/heic` → 400 `Formato de imagem não suportado. Use JPEG, PNG ou WebP.`; EMPLOYEE em `product-image` → 403.
- [ ] **Step 2: Run** `npm run test:int -- products-catalog-fields uploads.http` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; rodar também `npm run test:int -- products` (suítes antigas de produtos seguem verdes).
- [ ] **Step 5: Commit** `feat(products): categoria, marca, fornecedor, unidade, foto e custo com 4 casas`.

### Task 4: Importação e exportação de produtos com os campos novos

**Files:**
- Modify: `backend/src/modules/imports/handlers/products.import-handler.ts`, `backend/src/modules/imports/engine/normalize.ts`, `backend/src/modules/imports/engine/types.ts`, `backend/src/modules/imports/import-simulator.ts`, `backend/src/modules/products/products.export-handler.ts`
- Test: `products.import-handler.spec.ts`, `normalize.spec.ts`, novo `backend/src/modules/imports/import-catalog-fields.int-spec.ts`

**Interfaces:**
- Consumes: tabelas da Task 1; `categoryPathMap` (Task 2).
- Produces:
  - Campos novos do handler (todos `required: false, updatable: true`): `category` ("Categoria"; sinônimos `categoria, grupo, departamento, secao, familia`), `brand` ("Marca"; `marca, fabricante`), `supplier` ("Fornecedor"; `fornecedor, fornec`), `unit` ("Unidade"; `unidade, un, und, unid, medida`), `isPerishable` ("Perecível"; `perecivel, pereciveis`), `shelfLifeDays` ("Validade (dias)"; `validade, validade dias, dias validade, prazo validade`).
  - `normalize.ts`: `normalizeCategoryPath(text)` → `string[]` (separadores `>` ou `/`, aparado, 1–3 níveis; mais que 3 → erro `Categoria com mais de 3 níveis.`); `normalizeUnit(text)` → um de `PRODUCT_UNITS` (aceita `kg, quilo, kilo, un, unid, und, lt, litro, cx, caixa, pct, pacote, dz, duzia, m, metro, g, grama, ml`; outro → erro `Unidade desconhecida: <texto>.`); `parseBooleanPt(text)` (`sim/s/x/1/true` → true; `não/nao/n/0/false/vazio` → false); `parseMoney` passa a preservar até 4 casas no custo (`parseMoney(text, { decimals: 4 })`).
  - Hook opcional novo em `ImportResourceHandler`: `extraWarnings?(manager: EntityManager, rows: Record<string, unknown>[]): Promise<string[][]>` — chamado pelo simulador por lote; o handler de produtos devolve `CATEGORY_WILL_BE_CREATED`, `BRAND_WILL_BE_CREATED`, `SUPPLIER_WILL_BE_CREATED` (o painel já mostra avisos por código; acrescentar os textos "Categoria será criada", "Marca será criada", "Fornecedor será criado").
  - Na gravação (`applyBatch`): `resolveTaxonomyIds(manager, rows)` cria (com `INSERT … ON CONFLICT DO NOTHING` + releitura) categorias por caminho, marcas e fornecedores inexistentes, comparando nome sem diferenciar maiúsculas, e troca os textos pelos ids antes do INSERT/UPDATE. Taxonomia arquivada com o mesmo nome é **reativada**.
  - `ExistingProduct`/`beforeOf` passam a incluir os campos novos (ids), para a reversão (3.4) restaurá-los.
  - Exportação de produtos ganha colunas `Categoria` (caminho), `Marca`, `Fornecedor`, `Unidade`, `Perecível` (Sim/Não), `Validade (dias)`; `Custo` com 4 casas.
  - Handlers dedicados de **importação** para taxonomias ficam fora desta etapa (a criação automática cobre o caso comum) — registrar como menor no spec (seção 13).

- [ ] **Step 1: Write the failing tests**: unitários de `normalizeCategoryPath` (`"Mercearia > Bebidas"`, `"A/B/C/D"` erro), `normalizeUnit` (`"Kilo"` → `KG`, `"xx"` erro), `parseBooleanPt`, `parseMoney("3,1234", {decimals: 4})` → `3.1234`; `plan()` mostra diff dos campos novos; integração: importar planilha com `bebidas` quando existe `Bebidas` reaproveita; categoria/marca/fornecedor novos aparecem como aviso na simulação e são criados na gravação; marca arquivada é reativada; reverter a importação volta categoria/unidade anteriores; exportar e reimportar o mesmo arquivo dá tudo "sem alteração".
- [ ] **Step 2: Run** `npm test -- normalize products.import-handler` e `npm run test:int -- import-catalog-fields` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; depois `npm run test:int -- import` (todas as suítes de importação do SP3 verdes).
- [ ] **Step 5: Commit** `feat(imports): categoria, marca, fornecedor, unidade e validade na importação e exportação`.

### Task 5: Relatórios de perdas por categoria e por fornecedor

**Files:**
- Modify: `backend/src/modules/losses/losses.service.ts`, `losses.controller.ts`, `dto/query-losses.dto.ts`
- Test: `backend/src/modules/losses/losses-reports-catalog.http.int-spec.ts`

**Interfaces:**
- Produces: `GET /losses/reports/by-category?from&to&level=root|leaf` (padrão `root`) e `GET /losses/reports/by-supplier?from&to` → `{ id: string | null, label: string, totalQuantity, totalFinancialLoss }[]` no formato de `reportByReason`; produtos sem categoria/fornecedor entram numa linha `id: null, label: 'Sem categoria' | 'Sem fornecedor'`. Usa a categoria/fornecedor **atuais** do produto e o valor congelado (`LOSS_REVENUE_SQL`). `level=root` soma as subcategorias na raiz.

- [ ] **Step 1: Write the failing tests**: perdas em "Mercearia › Bebidas" e "Mercearia" somam em "Mercearia" com `level=root` e ficam separadas com `leaf`; produto sem categoria vira "Sem categoria"; filtro de período respeitado; outra empresa não aparece.
- [ ] **Step 2: Run** `npm run test:int -- losses-reports-catalog` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(losses): relatórios de perdas por categoria e fornecedor`.

### Task 6: Painel — telas de Categorias, Marcas e Fornecedores

**Files:**
- Create: `web-panel/src/app/(protected)/cadastros/categorias/page.tsx`, `…/marcas/page.tsx`, `…/fornecedores/page.tsx` (+ `page.spec.tsx` de cada), `web-panel/src/components/resources/taxonomy-page.tsx` (+ spec)
- Modify: `web-panel/src/components/nav.tsx`, `web-panel/src/lib/types.ts`, `web-panel/src/components/history-drawer.tsx` (entityTypes `category|brand|supplier`)

**Interfaces:**
- Consumes: rotas da Task 2.
- Produces: `TaxonomyPage` (props: `resource: 'categories'|'brands'|'suppliers'`, `auditEntityType`, `title`, `description`, `fields` do `ResourceFormDialog`) com abas Ativos/Arquivados, criar/editar pelo `ResourceFormDialog`, arquivar pelo `ArchiveDialog`, reativar, Histórico, Exportar. Categorias mostram o caminho e o formulário tem "Categoria pai" (select com as ativas, excluindo a própria e as descendentes). Menu Cadastros: `Produtos, Categorias, Marcas, Fornecedores, Motivo da Perda, Local da Perda, Importações`.

- [ ] **Step 1: Write the failing tests** (Vitest + Testing Library, mocks de `api` como em `motivos/page.spec.tsx`): lista e cria marca; erro 409 aparece no diálogo; categoria mostra "Mercearia > Bebidas" e o select de pai não oferece a própria categoria; arquivar chama `POST …/archive`; aba Arquivados chama `?includeArchived=true` e oferece Reativar; nav mostra os 3 itens novos.
- [ ] **Step 2: Run** `cd web-panel && npx vitest run cadastros/categorias cadastros/marcas cadastros/fornecedores taxonomy-page nav` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` limpo.
- [ ] **Step 5: Commit** `feat(web): telas de categorias, marcas e fornecedores`.

### Task 7: Painel — produto com os campos novos, filtros e foto

**Files:**
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`, `use-product-search.ts`, `web-panel/src/lib/types.ts`
- Create: `web-panel/src/components/products/product-form-fields.tsx` (+ spec), `web-panel/src/components/products/product-image-input.tsx` (+ spec), `web-panel/src/lib/resize-image.ts` (+ spec)

**Interfaces:**
- Consumes: Task 3 (campos, filtros, `POST uploads/product-image`), Task 2 (listas).
- Produces:
  - `resizeImage(file: File, maxSide = 800): Promise<Blob>` — JPEG 0,85 via `createImageBitmap` + `<canvas>`; se o navegador não conseguir ler o arquivo, rejeita com `Não foi possível ler esta imagem. Use JPEG, PNG ou WebP.`
  - Formulário: Categoria (select com caminho), Marca, Fornecedor, Unidade, Perecível (switch) + Validade em dias (aparece só se perecível), Custo aceita 4 casas, Observações, Foto (pré-visualização, trocar, remover). Taxonomia arquivada já ligada aparece com "(arquivada)".
  - Lista: miniatura 32 px, coluna Unidade, filtros Categoria/Marca/Fornecedor/Unidade na barra de busca (vão para a query de `use-product-search`).
  - `page.tsx` está com 552 linhas: os campos do formulário saem para `product-form-fields.tsx`.

- [ ] **Step 1: Write the failing tests**: `resizeImage` reduz 1600×1200 para 800×600 (mock de canvas); `ProductImageInput` mostra erro para arquivo > 8 MB sem chamar a API; formulário envia `categoryId/unit/isPerishable/shelfLifeDays/costPrice 3.1234`; validade some quando desmarca perecível e envia `shelfLifeDays: null`; filtro de categoria vai para a URL da busca; categoria arquivada ligada mostra "(arquivada)".
- [ ] **Step 2: Run** `npx vitest run produtos product-form-fields product-image-input resize-image` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx vitest run` inteiro sem regressão; `npx tsc --noEmit` limpo.
- [ ] **Step 5: Commit** `feat(web): produto com categoria, marca, fornecedor, unidade, validade e foto`.

### Task 8: Painel — dashboard por categoria e fornecedor

**Files:**
- Modify: `web-panel/src/app/(protected)/dashboard/page.tsx`, `web-panel/src/components/losses-breakdown-chart.tsx` (+ specs), `web-panel/src/lib/types.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces: `LossesBreakdownChart` passa a receber `rows: { label: string; totalFinancialLoss: string | number }[]` (o componente não escolhe mais a visão); a página tem as abas **Motivo, Local, Categoria, Fornecedor** e busca `by-category?level=root` e `by-supplier` junto com as outras (sequencial não é necessário no painel).

- [ ] **Step 1: Write the failing tests**: trocar para a aba Categoria mostra as fatias de `by-category`; "Sem categoria" aparece como fatia; spec antigo das abas Motivo/Local continua passando com a nova prop.
- [ ] **Step 2: Run** `npx vitest run dashboard losses-breakdown-chart` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): composição das perdas por categoria e fornecedor no dashboard`.

### Task 9: App — unidade, foto e quantidade fracionada

**Files:**
- Modify: `mobile_app/lib/core/storage/app_database.dart` (v3), `mobile_app/lib/data/models/product.dart`, `mobile_app/lib/data/repositories/product_repository.dart`, `mobile_app/lib/presentation/screens/loss_form_screen.dart`
- Test: `mobile_app/test/…` (padrão dos testes existentes de banco/modelo/tela)

**Interfaces:**
- Consumes: payload do sync da Task 3 (`unit`, `imageUrl`, `isPerishable`).
- Produces: `AppDatabase.currentVersion = 3`; migração 3 faz `ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'UN'`, `imageUrl TEXT`, `isPerishable INTEGER NOT NULL DEFAULT 0` e **zera o cursor do sync de produtos** (como a v2) para baixar os campos; `_onCreate` já cria com as colunas. `Product` ganha `unit` (padrão `'UN'`), `imageUrl`, `isPerishable`, getter `bool get isFractional` (`KG, G, L, ML, M`). Formulário: mostra a unidade ao lado da quantidade ("kg"), aceita decimais só se `isFractional` (senão só inteiros, e "1,5" dá erro "Quantidade inteira para esta unidade."), e mostra a foto do produto (`Image.network` com `errorBuilder` silencioso — sem internet mostra só o nome).

- [ ] **Step 1: Write the failing tests**: migração de um banco v2 para v3 preserva produtos e zera o cursor; `Product.fromApiJson` sem `unit` → `'UN'`; tela com produto KG aceita `0,850`; tela com produto UN recusa `1,5`.
- [ ] **Step 2: Run** `cd mobile_app && C:/flutter/bin/flutter test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `C:/flutter/bin/flutter test` → PASS; `C:/flutter/bin/flutter analyze` sem problemas.
- [ ] **Step 5: Commit** `feat(mobile): unidade, foto e quantidade fracionada no registro de perda`.

### Task 10: Verificação ponta a ponta, docs e entrada no sistema

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-sp4-produtos-2-0-design.md` (seção 13: menores), `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10, linha SP4)

- [ ] **Step 1:** Suítes completas: backend `npm test`, `npm run test:int`, `npx tsc --noEmit -p tsconfig.json`; painel `npx vitest run`, `npx tsc --noEmit`; app `flutter test`, `flutter analyze`. Anotar os novos totais (baselines: backend unit 32/307, int 40/314; web 60/364; app 27).
- [ ] **Step 2:** Banco `inventory_saas`: `docker exec backend-postgres-1 pg_dump -U postgres -Fc inventory_saas > C:\PROJETOS\SAAS-backups\inventory_saas-antes-20000-<data>.dump`; `cd backend && npm run migration:run`; conferir `SELECT count(*) FROM products WHERE unit = 'UN'` = total de produtos.
- [ ] **Step 3:** `cd backend && docker compose up -d --build backend`; no navegador (painel 3001, login Gerente): criar categoria "Mercearia › Bebidas", marca, fornecedor; editar um produto com tudo + foto; filtrar por categoria; dashboard aba Categoria; importar uma planilha pequena com Categoria/Marca/Unidade e ver os avisos "será criada". Screenshot como prova.
- [ ] **Step 4:** Revisão final da branch por subagente (modelo mais capaz); corrigir Críticos/Importantes com TDD; menores na seção 13 do spec.
- [ ] **Step 5:** Atualizar a seção 10 do mestre; commit `docs: SP4 etapa 4.1 concluída`; oferecer merge em `main` + push.

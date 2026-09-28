# SP3 etapa 3.3 — Exportação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o gerente exporta produtos (com os filtros da tela), motivos, locais e usuários em `.xlsx` ou `.csv`, direto em streaming, num formato que a importação relê sem mapear.

**Architecture:** um motor pequeno em `backend/src/modules/exports/` — contrato `ExportResourceHandler` (colunas + contagem + página por keyset de `id`) e `streamExport()` que conta antes (> 200 mil ⇒ 400, sem abrir a resposta), escreve o cabeçalho HTTP e despeja páginas de 2.000 linhas num `exceljs.stream.xlsx.WorkbookWriter` ou em CSV (`;`, BOM, CRLF). Cada recurso ganha `GET <recurso>/export` no próprio controller, antes das rotas com `:id`. No painel, um `ExportButton` (menu Excel/CSV) baixa por `api.getBlob`.

**Tech Stack:** NestJS 10 + TypeORM (manager do tenant, RLS) + exceljs (streaming writer); Next.js + vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-sp3-importacao-exportacao-design.md` (seção 4; seção 3 para as rotas; I6; seção 6 para os botões)

## Global Constraints

- Rotas: `GET /products/export?format=&status=&q=`, `GET /loss-reasons/export`, `GET /loss-locations/export`, `GET /users/export` (`format` = `xlsx` padrão | `csv`); guards `JwtAuthGuard`, `SubscriptionGuard`, `RolesGuard` com `manager`.
- Streaming sem job assíncrono; páginas por keyset (`id`) de **2.000** linhas; > **200.000** linhas ⇒ 400 `EXPORT_TOO_LARGE` antes de começar (I6).
- CSV: separador `;`, BOM UTF-8, CRLF. Toda célula de texto que começa com `=`, `+`, `-`, `@`, tab ou CR recebe `'` na frente (xlsx **e** csv).
- Produtos: `Código de barras`, `Nome`, `SKU`, `Preço de venda`, `Custo`, `Situação` (Ativo/Arquivado); código em formato texto (`@`); preços como número com 2 casas (`0.00` no xlsx; `12,50` no csv).
- Motivos/locais: `Nome`, `Criado em` (desvio da spec: sem `Situação` — motivos/locais ainda não têm arquivamento; volta no SP5). Usuários: `Nome`, `E-mail`, `Papel`, `Situação`, `Criado em` — nunca senha/hash.
- Nome do arquivo: `<base>-AAAA-MM-DD.<ext>` com a data de São Paulo (`produtos`, `motivos-de-perda`, `locais-de-perda`, `usuarios`).
- Datas: xlsx como data com `dd/mm/yyyy hh:mm`; csv como `dd/mm/aaaa hh:mm` em `America/Sao_Paulo`.
- Backend: `npm test`, `npm run test:int` (nunca em paralelo), `npx tsc --noEmit -p tsconfig.json`. Web: `npm test`, `npx tsc --noEmit`. Nunca `git add -A` na raiz.

## Review Focus

1. **Texto que vira fórmula** (`=HYPERLINK(...)`, `+55…`, `-5`, `@SOMA`) em nome/SKU/e-mail: sai com `'` nos dois formatos — Task 1 (unit) e Task 2 (integração xlsx e csv).
2. **Código de barras longo ou com zero à esquerda** (`0789…`, 14 dígitos): continua texto no xlsx, sem notação científica — Task 2.
3. **Dados de outra empresa** (RLS): nunca aparecem — Task 2 (produtos) e Task 3 (usuários).
4. **Filtro trocado logo antes de exportar** (aba Arquivados, busca digitada): a exportação usa os filtros atuais da tela — Task 4.
5. **Acima do limite / erro do backend**: o painel mostra a mensagem, não baixa arquivo pela metade nem fica "Gerando…" — Task 4.

---

### Task 1: Motor de exportação

**Files:** Create `backend/src/modules/exports/export-handler.ts`, `export-writer.ts` (+ `export-writer.spec.ts`) — funções puras, sem módulo Nest; Modify `backend/src/common/csv.ts` (extrai a proteção de fórmula).

**Interfaces (Produces):**
- `common/csv.ts`: `protectFormula(text: string): string` (usada por `csvCell`, comportamento de `csvCell` inalterado).
- `export-handler.ts`:
  ```ts
  type ExportCellType = 'text' | 'money' | 'datetime';
  interface ExportColumn<R> { header: string; type: ExportCellType; width?: number; value(row: R): string | number | Date | null }
  interface ExportResourceHandler<R extends { id: string }, F = unknown> {
    fileBase: string; sheetName: string; columns: ExportColumn<R>[];
    count(manager: EntityManager, filters: F): Promise<number>;
    page(manager: EntityManager, filters: F, afterId: string | null, limit: number): Promise<R[]>; // ORDER BY id
  }
  ```
- `export-writer.ts`: `EXPORT_PAGE_SIZE = 2000`, `EXPORT_MAX_ROWS = 200_000`; `exportFileName(fileBase, format, now = new Date()): string`; `formatCsvValue(type, value): string` (money ⇒ `12,50`; datetime ⇒ `dd/mm/aaaa hh:mm` SP; texto protegido); `streamExport<R,F>(res: Response, handler, filters: F, format: 'xlsx' | 'csv', opts?: { maxRows?: number }): Promise<void>` — lança `BadRequestException({ errorCode: 'EXPORT_TOO_LARGE', message: 'A exportação passa de 200.000 linhas. Filtre antes de exportar.' })` antes de tocar na resposta; senão `Content-Type` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `text/csv; charset=utf-8`), `Content-Disposition: attachment; filename="<nome>"` e as páginas. xlsx: `new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true })`, colunas `text` com `numFmt '@'`, `money` `'0.00'`, `datetime` `'dd/mm/yyyy hh:mm'`, `row.commit()` por linha, `workbook.commit()` no fim. Texto passa por `protectFormula` nos dois formatos.

- [ ] **Step 1: Testes que falham** (`export-writer.spec.ts`, com `Writable` em memória como `res` falso que guarda cabeçalhos): `protectFormula` para `=A1`, `+55`, `-5`, `@x`, `\tx`, `\rx` e texto normal; `formatCsvValue('money', '10.5') === '10,50'`, `('money', null) === ''`, `('datetime', new Date('2026-09-28T15:04:00Z')) === '28/09/2026 12:04'`; `exportFileName('produtos','xlsx', new Date('2026-09-28T02:00:00Z')) === 'produtos-2026-09-27.xlsx'` (fuso SP); `streamExport` csv com handler falso de 3 linhas e `EXPORT_PAGE_SIZE` respeitado (handler registra os `afterId` pedidos: `[null, <id da 2000ª>]` quando há 2.500 linhas); começa com BOM, `;`, CRLF; `count` > `maxRows` ⇒ `EXPORT_TOO_LARGE` e nenhum cabeçalho escrito; xlsx lido de volta com `ExcelJS.Workbook().xlsx.load` tem os cabeçalhos, o texto protegido e o número.
- [ ] **Step 2:** `npm test -- export-writer csv` ⇒ FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test -- export-writer csv` ⇒ PASS; `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5:** Commit — `feat(exports): motor de exportação em streaming (xlsx/csv, limite e proteção de fórmula)`

### Task 2: Exportação de produtos

**Files:** Create `backend/src/modules/products/products.export-handler.ts`, `backend/src/modules/products/dto/export-products.dto.ts`, `backend/src/modules/exports/dto/export-format.dto.ts`, `backend/src/modules/products/products-export.http.int-spec.ts`; Modify `products.controller.ts`, `products-search.ts` (extrai o filtro).

**Interfaces:**
- `ExportFormatDto { format?: 'xlsx' | 'csv' }` (`@IsOptional() @IsIn`).
- `ExportProductsDto extends ExportFormatDto { q?: string (≤100); status?: ProductStatusFilter }` — padrão `status` = `active` (igual à busca).
- `applyProductFilters(qb: SelectQueryBuilder<Product>, filters: { q?: string; status?: ProductStatusFilter }): void` em `products-search.ts`, usada por `ProductsService.search` e pelo handler (mesmo filtro da tela).
- `productsExportHandler: ExportResourceHandler<Product, ExportProductsDto>` — `fileBase 'produtos'`, `sheetName 'Produtos'`; colunas na ordem da Global Constraints (código `text` com `width 18`).
- Rota `@Get('export') @Roles(MANAGER) async export(@Query() q: ExportProductsDto, @Res() res: Response)` ⇒ `streamExport(res, productsExportHandler, q, q.format ?? 'xlsx')`, declarada antes de `:id`.

- [ ] **Step 1: Testes que falham** (`products-export.http.int-spec.ts`, app com `ProductsController` como nos outros `products*.http.int-spec`): xlsx lido com exceljs — cabeçalhos exatos; `0789123` continua `'0789123'` e a célula tem `numFmt '@'`; preço `12.5` sai número `12.5` com `numFmt '0.00'`; `Situação` Ativo; nome `=HYPERLINK("x")` sai `'=HYPERLINK("x")`; padrão só ativos; `status=archived` só arquivados; `status=all&q=arr` filtra pelo nome; produto de outra empresa não sai; csv começa com BOM, cabeçalho `Código de barras;Nome;SKU;Preço de venda;Custo;Situação`, preço `12,50`; `Content-Disposition` `produtos-AAAA-MM-DD.csv`; 2.500 produtos (via `generate_series`) ⇒ 2.501 linhas; funcionário ⇒ 403; **reimportação**: o xlsx exportado, enviado a `POST /imports` (app de importações), volta com `suggestedMapping` dos 5 campos (use `startImportsApp` num `describe` separado ou suba os dois controllers juntos).
- [ ] **Step 2:** `npm run test:int -- products-export` ⇒ FAIL (404).
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run test:int -- products-export products-search` ⇒ PASS; tsc.
- [ ] **Step 5:** Commit — `feat(products): exportar produtos em xlsx/csv com os filtros da tela`

### Task 3: Motivos, locais e usuários

**Files:** Create `backend/src/modules/loss-reasons/loss-reasons.export-handler.ts`, `backend/src/modules/loss-locations/loss-locations.export-handler.ts`, `backend/src/modules/users/users.export-handler.ts`, `backend/src/modules/exports/catalog-exports.http.int-spec.ts`; Modify os três controllers.

**Interfaces:**
- Motivos/locais: `fileBase 'motivos-de-perda'` / `'locais-de-perda'`; colunas `Nome` (text), `Criado em` (datetime).
- Usuários: `fileBase 'usuarios'`; `Nome`, `E-mail`, `Papel` (`manager` ⇒ `Gerente`, `employee` ⇒ `Funcionário`), `Situação` (`Ativo`/`Inativo`), `Criado em`; `page` seleciona só essas colunas (nunca `passwordHash`) e só usuários da empresa (RLS + `companyId` do contexto, excluindo master).
- Rotas `GET loss-reasons/export`, `GET loss-locations/export`, `GET users/export` com `ExportFormatDto`, `@Roles(MANAGER)`, antes das rotas com `:id`.

- [ ] **Step 1: Testes que falham** (`catalog-exports.http.int-spec.ts`): motivos em csv (cabeçalho `Nome;Criado em`, nome com `+` protegido, data `dd/mm/aaaa hh:mm`); locais em xlsx; usuários em xlsx sem nenhuma coluna/valor de hash (`$2` não aparece no arquivo), só os da empresa, papéis traduzidos; funcionário ⇒ 403 nas três.
- [ ] **Step 2:** `npm run test:int -- catalog-exports` ⇒ FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** ⇒ PASS; `npm test`, `npm run test:int`, tsc.
- [ ] **Step 5:** Commit — `feat(exports): exportar motivos, locais e usuários`

### Task 4: Botões Exportar no painel

**Files:** Create `web-panel/src/components/export-button.tsx` (+ spec); Modify `app/(protected)/cadastros/produtos/page.tsx` (+ spec), `components/resources/simple-catalog-page.tsx` (+ spec novo ou no de motivos), `app/(protected)/users/page.tsx` (+ spec).

**Interfaces:**
- `ExportButton({ path: string; fileBase: string; params?: Record<string, string | undefined> })`: botão "Exportar" que abre um menu (`role="menu"`) com `menuitem` "Excel (.xlsx)" e "CSV (.csv)"; ao escolher ⇒ `api.getBlob(`${path}?format=<fmt>&<params não vazios>`)` ⇒ `downloadBlob(blob, `${fileBase}-<AAAA-MM-DD local>.<fmt>`)` (`downloadBlob` de `lib/imports.ts`); durante o download o botão mostra "Gerando…" desabilitado; `ApiError` ⇒ mensagem em `role="alert"`; fecha o menu com Esc ou ao escolher.
- Produtos: `<ExportButton path="products/export" fileBase="produtos" params={{ status, q: search.trim() || undefined }} />` ao lado de "Importar planilha" (usa o `status`/`search` do `useProductSearch`).
- `SimpleCatalogPage`: `<ExportButton path={`${resource}/export`} fileBase={resource === 'loss-reasons' ? 'motivos-de-perda' : 'locais-de-perda'} />` no cabeçalho.
- Usuários: `<ExportButton path="users/export" fileBase="usuarios" />` no cabeçalho.

- [ ] **Step 1: Testes que falham** — `export-button.spec.tsx`: menu com as duas opções; xlsx chama `getBlob('products/export?format=xlsx&status=archived')` (parâmetro vazio omitido) e baixa `produtos-<data>.xlsx`; erro 400 mostra a mensagem e reabilita; "Gerando…" enquanto baixa. Produtos: trocar para "Arquivados" e digitar "arroz" ⇒ exportar pede `status=archived&q=arroz`. Motivos (SimpleCatalogPage) e Usuários: botão presente e caminho certo.
- [ ] **Step 2:** `npx vitest run src/components/export-button.spec.tsx "src/app/(protected)/cadastros/produtos" src/components/resources "src/app/(protected)/users"` ⇒ FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** ⇒ PASS; `npm test`; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit — `feat(web): botões Exportar em produtos, motivos, locais e usuários`

### Task 5: Verificação no navegador e documentação

- [ ] **Step 1:** Suítes completas (backend unit/int/tsc/build; web test/tsc).
- [ ] **Step 2:** Navegador (preview `backend` + `web-panel`, "Entrar como Gerente"): Produtos › Exportar › Excel e CSV (conferir pela rede o status 200, `Content-Disposition` e tamanho); aba Arquivados + busca ⇒ query certa; Motivos, Locais e Usuários exportam; reimportar o xlsx exportado no assistente ⇒ colunas todas sugeridas e simulação "Sem mudança".
- [ ] **Step 3:** Documentar (spec seção 9, mestre seção 10) e commit — `docs: SP3 etapa 3.3 concluída`.

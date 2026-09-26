# SP3 etapa 3.1.1 — Motor de importação: leitura, normalização e simulação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o backend aceita `.xlsx`/`.csv` em `POST /imports`, sugere o mapeamento, simula a importação de produtos numa tabela de preparação (`import_rows`) e expõe linhas, ausentes e relatório CSV — sem ainda gravar produtos.

**Architecture:** módulo `imports` ganha um motor genérico (`engine/`: normalização, leitura em streaming, sugestão de mapeamento, relatório) e um handler de produtos (`handlers/`). Upload/preview são síncronos; a simulação roda num worker BullMQ (fila `imports`), enfileirada só depois do commit (`afterCommit`). O fluxo antigo (`POST /products/import`, fila `products-import`) fica intocado nesta etapa.

**Tech Stack:** NestJS 10, TypeORM 0.3 (SQL cru nas migrations), Postgres 16 com RLS, BullMQ, exceljs 4.4 (`stream.xlsx.WorkbookReader`), `csv-parse` e `iconv-lite` (novas — D6/I5), Jest (unit `*.spec.ts`; integração `*.int-spec.ts` com `npm run test:int`).

**Spec:** `docs/superpowers/specs/2026-09-26-sp3-importacao-exportacao-design.md` (seções 1, 2.1–2.3, 3, 5, 8)

## Global Constraints

- Mensagens ao usuário em **português**; `errorCode` em inglês maiúsculo (`UNSUPPORTED_FILE`, `FILE_TOO_LARGE_UNCOMPRESSED`, `MAPPING_INVALID`, `INVALID_STATE`).
- Limites: arquivo **20 MB**; descompactado **200 MB** ou razão > **100**; **200 mil** linhas de dados; amostra de **20** linhas; `errorReport` ≤ **200** entradas.
- Toda tabela nova: `ENABLE` + `FORCE ROW LEVEL SECURITY`, política com `TENANT_COMPANY_ID_PREDICATE` (USING e WITH CHECK), `GRANT` condicional ao `inventory_saas_app` (molde de `1700000017000-ApprovalRequests.ts`).
- Entidades novas entram em `backend/src/database/entities.ts` (`ENTITIES`).
- Migration nova: `1700000018000-ImportsV2.ts`. Não aplicar no banco `inventory_saas` sem backup `pg_dump` antes.
- Rotas novas: `JwtAuthGuard`, `SubscriptionGuard`, `RolesGuard` + `@Roles(UserRole.MANAGER)`.
- Nada de `String(cell.value)` em célula de planilha: sempre `cellToText`.
- CSV gerado: `;`, CRLF, BOM UTF-8, células pelo `csvCell` (proteção de fórmula) — o mesmo do CSV da auditoria.
- `npm run test:int` nunca em paralelo com outra execução dele.

## Review Focus

1. **Código de barras numérico no xlsx** (`7891234567895` como número, `1.23E+12` exibido) deve virar o texto exato dos dígitos, sem `e+` nem `.0` — teste em Task 2 (`cellToText` com número grande) e Task 3 (planilha com a coluna numérica).
2. **CSV do Excel brasileiro** (Windows-1252, `;`, "Descrição" com acento, preço `1.234,56`) — Task 3 (decodificação + delimitador) e Task 6 (simulação ponta a ponta com esse CSV).
3. **Cabeçalho com espaços/acentos/maiúsculas diferentes do mapeamento salvo** ("  Cód. Barras ") deve casar pelo cabeçalho normalizado — Task 4 (`headerFingerprint` igual para variações) e Task 5 (upload reconhece o mapeamento salvo).
4. **Mensagem velha na fila** (simulação substituída por outra) não pode sobrescrever a nova — Task 6 (`run` com `runId` antigo não toca o job).
5. **Planilha com linhas em branco no meio e no fim** (comum no export de ERP) não conta como linha nem vira erro — Task 3 (leitor pula linha vazia) e Task 6 (`totalRows` ignora).

---

## File Structure

```
backend/src/common/csv.ts                                   (novo) csvCell/csvLine — extraídos da auditoria
backend/src/common/tenant/tenant-storage.ts                 (mod) afterCommit(fn)
backend/src/common/tenant/tenant-context.middleware.ts      (mod) roda os callbacks após commit
backend/src/database/migrations/1700000018000-ImportsV2.ts  (novo)
backend/src/modules/imports/
  import-job.entity.ts            (mod) colunas novas; status varchar
  import-row.entity.ts            (novo)
  import-mapping.entity.ts        (novo)
  engine/types.ts                 (novo) contratos do motor
  engine/normalize.ts (+ .spec)   (novo) normalizadores puros
  engine/file-sniff.ts (+ .spec)  (novo) formato, zip bomb, codificação, delimitador
  engine/sheet-reader.ts (+ .spec)(novo) leitura xlsx/csv em streaming
  engine/mapping.ts (+ .spec)     (novo) cabeçalho normalizado, fingerprint, sugestão
  engine/report-csv.ts (+ .spec)  (novo) CSV de erros/avisos
  handlers/products.import-handler.ts (+ .spec) (novo) campos + plano por linha + ausentes
  handlers/index.ts               (novo) getImportHandler(resource)
  import-jobs.service.ts          (novo) upload/preview/simulate/consultas
  import-simulator.ts             (novo) worker da simulação (classe pura, sem decorators)
  imports-queue.processor.ts      (novo) @Processor('imports') → simulator
  import-mappings.service.ts      (novo)
  import-jobs.controller.ts       (novo) /imports
  import-mappings.controller.ts   (novo) /import-mappings
  dto/simulate-import.dto.ts, dto/import-mapping.dto.ts, dto/list-import-rows.dto.ts (novos)
  imports.module.ts               (mod)
backend/src/test-utils/imports-test-app.ts                  (novo) app Nest com storage/fila falsos
backend/src/modules/imports/*.int-spec.ts                   (novos)
```

---

### Task 1: Migration, entidades, `afterCommit` e dependências

**Files:**
- Create: `backend/src/database/migrations/1700000018000-ImportsV2.ts`, `backend/src/modules/imports/import-row.entity.ts`, `backend/src/modules/imports/import-mapping.entity.ts`, `backend/src/common/csv.ts`
- Modify: `backend/src/modules/imports/import-job.entity.ts`, `backend/src/database/entities.ts`, `backend/src/common/tenant/tenant-storage.ts`, `backend/src/common/tenant/tenant-context.middleware.ts`, `backend/src/modules/audit/audit.service.ts` (importa `csvCell` de `common/csv`), `backend/package.json`
- Test: `backend/src/modules/imports/imports-v2-schema.int-spec.ts`, `backend/src/common/tenant/tenant-context.middleware.int-spec.ts` (acrescentar caso; se o arquivo existente tiver outro nome, acrescentar no spec de integração do middleware que já existe), `backend/src/common/csv.spec.ts`

**Interfaces:**
- Produces:
  - `ImportJobStatus` (string union/enum) com: `pending, processing, completed, failed, uploaded, simulating, simulated, pending_approval, applying, cancelled, rolling_back, rolled_back`.
  - `ImportJob` com os campos da spec 1.1 (`resource, fileHash, format, encoding, delimiter, sheetName, headers: string[]|null, sheets: string[]|null, mapping: Record<string,string>|null, options: ImportOptions|null, summary: ImportSummary|null, errorReportKey, createdByUserId, changeRequestId, simulatedAt, appliedAt, rolledBackAt, lastError`).
  - `ImportOptions { updateFields: string[]; archiveMissing?: boolean; confirmArchiveCount?: number; runId?: string; autoApply?: boolean }`; `ImportSummary { totalRows: number; counts: Record<RowAction, number>; warnings: Record<string, number>; missingCount: number; sensitive: { priceChange: number; archiveWithHistory: number }; appliedCount?: number; rolledBackCount?: number; conflictCount?: number; rowsPurged?: boolean }` (em `import-job.entity.ts`).
  - `ImportRow` e `ImportMapping` entidades (colunas da spec 1.2/1.3; `import_rows.id` bigserial ⇒ `string` no TS).
  - `afterCommit(fn: () => Promise<void> | void): void` em `tenant-storage.ts`.
  - `csvCell(value: unknown): string`, `csvLine(values: unknown[]): string` em `common/csv.ts`.

- [ ] **Step 1: Instalar dependências** — `cd backend && npm install csv-parse@^5 iconv-lite@^0.6`. Esperado: ambas em `dependencies`.
- [ ] **Step 2: Testes que falham** (`imports-v2-schema.int-spec.ts`):
  - `import_rows` e `import_mappings` têm `relrowsecurity` e `relforcerowsecurity` true (`pg_class`).
  - Com `withTenant(empresaA)`, um `INSERT` em `import_rows` com `companyId` da empresa B falha (WITH CHECK) e um `SELECT` não enxerga linhas de B.
  - `import_jobs.status` aceita `'simulated'` e recusa `'xyz'` (CHECK).
  - `import_mappings` recusa dois `(companyId, resource, name)` iguais.
  - `product_price_history` aceita `source = 'import_rollback'`.
  - Linha antiga com `status = 'completed'` continua legível depois da migration (o harness recria o banco: basta inserir e ler).
  - Middleware: numa rota de teste que chama `afterCommit(cb)` e responde 200, `cb` roda depois do commit (lê de outra conexão a linha que a rota inseriu) e antes da resposta chegar; numa rota que responde 400, `cb` não roda.
  - `csv.spec.ts`: `csvCell('=SOMA(A1)') === "'=SOMA(A1)"`, `csvCell('a;b') === '"a;b"'`, `csvCell(null) === ''`, `csvLine(['a', 1]) === 'a;1'`.
- [ ] **Step 3: Rodar e ver falhar** — `npm test -- csv.spec` e `npm run test:int -- imports-v2-schema tenant-context`. Esperado: FAIL (tabelas/funções inexistentes).
- [ ] **Step 4: Migration `ImportsV2 1700000018000`** (numa transação só):
  - `import_jobs.status`: `ALTER COLUMN status DROP DEFAULT`, `TYPE varchar(20) USING status::text`, `SET DEFAULT 'uploaded'`, CHECK com os 12 valores; `DROP TYPE import_job_status_enum`. `down()` recria o enum com os 4 valores antigos (convertendo os novos para `failed`).
  - Colunas novas de `import_jobs` (spec 1.1) + índice `idx_import_jobs_company_created ("companyId","createdAt" DESC)`.
  - `import_rows` e `import_mappings` com os índices da spec; RLS no molde; `GRANT SELECT, INSERT, UPDATE, DELETE` (a limpeza apaga linhas) ao `inventory_saas_app`.
  - CHECK de `product_price_history.source`: `DROP CONSTRAINT` + recria com `'import_rollback'` a mais (descobrir o nome da constraint via `pg_constraint` dentro de um `DO $$`).
- [ ] **Step 5: Entidades** — `ImportJob` com `status` `varchar` (`@Column({ type: 'varchar', length: 20, default: 'uploaded' })`); `ImportRow`, `ImportMapping`; registrar em `ENTITIES`.
- [ ] **Step 6: `afterCommit`** — `TenantContext.afterCommit?: Array<() => Promise<void> | void>`; `afterCommit(fn)` empurra no array do contexto atual (fora de requisição ⇒ lança o mesmo erro de `getTenantContext`). No middleware, em `finishTransaction` com `commit = true` e sucesso, roda os callbacks em ordem, cada um em `try/catch` com `this.logger.error` — antes de `originalEnd`.
- [ ] **Step 7: `common/csv.ts`** — move `csvCell` da auditoria (mesmo corpo) + `csvLine`; `audit.service.ts` passa a importar.
- [ ] **Step 8: Rodar** — `npm test` e `npm run test:int` completos; `npx tsc --noEmit -p tsconfig.json`. Esperado: tudo verde (o teste antigo do `ImportsProcessor` continua passando: ele insere `import_jobs` sem status e recebe `'uploaded'`, depois o processor grava `processing`/`completed`, que seguem válidos).
- [ ] **Step 9: Commit** — `feat(imports): schema da importação 2.0 (import_rows, import_mappings) e afterCommit`

### Task 2: Normalizadores de célula

**Files:**
- Create: `backend/src/modules/imports/engine/types.ts`, `backend/src/modules/imports/engine/normalize.ts`
- Test: `backend/src/modules/imports/engine/normalize.spec.ts`

**Interfaces:**
- Produces (em `engine/types.ts`):
  - `type RowAction = 'create' | 'update' | 'reactivate' | 'unchanged' | 'error' | 'duplicate' | 'archive'`
  - `interface NormalizeResult<T = unknown> { value: T; errors: string[]; warnings: string[] }`
- Produces (em `engine/normalize.ts`):
  - `cellToText(value: ExcelJS.CellValue): { text: string | null; error?: string }`
  - `normalizeBarcode(text: string | null): NormalizeResult<string | null>`
  - `parseMoney(text: string | null): NormalizeResult<number | null>` (`null` = não informado)
  - `normalizeName(text: string | null): NormalizeResult<string | null>`
  - `normalizeSku(text: string | null): NormalizeResult<string | null>`
  - `gtinCheckDigitValid(digits: string): boolean`

- [ ] **Step 1: Testes que falham** (tabelas `it.each`):
  - `cellToText`: `null`/`undefined`/`''` ⇒ `{ text: null }`; `'  abc '` ⇒ `'  abc '` (quem apara é o normalizador do campo); `7891234567895` ⇒ `'7891234567895'`; `1e21` ⇒ `'1000000000000000000000'`; `12.5` ⇒ `'12.5'`; `{ formula: 'A1*2', result: 20 }` ⇒ `'20'`; `{ formula: 'X', result: { error: '#N/A' } }` ⇒ `{ text: null, error: 'Célula com erro (#N/A).' }`; `{ richText: [{ text: 'Arroz ' }, { text: 'Tipo 1' }] }` ⇒ `'Arroz Tipo 1'`; `{ text: 'site', hyperlink: 'http://x' }` ⇒ `'site'`; `new Date(Date.UTC(2026, 8, 1))` ⇒ `'2026-09-01'`; `{ error: '#DIV/0!' }` ⇒ erro `'Célula com erro (#DIV/0!).'`; `true` ⇒ `'true'`.
  - `normalizeBarcode`: `' 789.1234-567 895 '` ⇒ `'7891234567895'` sem avisos; `'ABC-123'` ⇒ `'ABC-123'`; `''`/`null` ⇒ erro `'Código de barras vazio.'`; 65 caracteres ⇒ erro `'Código de barras com mais de 64 caracteres.'`; `'1234567'` ⇒ aviso `GTIN_LENGTH_SUSPECT`; `'12345678901'` ⇒ `GTIN_LENGTH_SUSPECT`; `'7891234567895'` válido ⇒ sem aviso; `'7891234567890'` ⇒ `GTIN_CHECK_DIGIT`; `'036000291452'` (UPC-A válido, 12 dígitos) ⇒ sem aviso; `'12345'` ⇒ sem aviso (código interno curto).
  - `parseMoney`: `'12,50'`⇒12.5; `'1.234,56'`⇒1234.56; `'R$ 12,50'`⇒12.5; `'R$ 1.234,56'`⇒1234.56; `'12.5'`⇒12.5; `'1,234.56'`⇒1234.56; `'1.234'`⇒1.234 com aviso `AMBIGUOUS_DECIMAL`… **e** arredondado para 1.23 com aviso `PRICE_ROUNDED` (os dois avisos); `'1.234.567'`⇒1234567; `'1,5'`⇒1.5; `'1,234,567'`⇒1234567; `'12,345'`⇒12.345⇒12.35 + `PRICE_ROUNDED`; `''`/`null`⇒`value: null` sem erro; `'abc'`⇒erro `'Preço inválido: "abc".'`; `'-5'`⇒erro `'Preço negativo: "-5".'`; `'10000000000'`⇒erro `'Preço acima do limite: "10000000000".'`; `'0,005'` ⇒ 0.01 (meio para cima) + `PRICE_ROUNDED`.
  - `normalizeName`: `'  Arroz   Tipo 1 '` ⇒ `'Arroz Tipo 1'`; vazio ⇒ erro `'Nome do produto vazio.'`; 201 caracteres ⇒ 200 caracteres + aviso `NAME_TRUNCATED`.
  - `normalizeSku`: `' A1 '` ⇒ `'A1'`; vazio ⇒ `null` sem erro; 61 caracteres ⇒ erro `'SKU com mais de 60 caracteres.'`.
  - `gtinCheckDigitValid('7891234567895') === true`, `('96385074') === true`, `('7891234567890') === false`.
- [ ] **Step 2: Rodar e ver falhar** — `npm test -- normalize.spec`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** as funções. `parseMoney`: remover `R$`, espaços e NBSP; aplicar a regra de separadores da spec 2.2; arredondar em centavos inteiros (`Math.round(x * 100 + Number.EPSILON) / 100` com a checagem de "mais de 2 casas" feita no texto, não no float); `AMBIGUOUS_DECIMAL` só quando há **um** `.`, nenhuma `,` e exatamente 3 dígitos depois. `cellToText` de número inteiro: `Number.isSafeInteger(n) ? String(n) : BigInt(Math.round(n)).toString()`; data em UTC `toISOString().slice(0, 10)`.
- [ ] **Step 4: Rodar** — `npm test -- normalize.spec`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): normalizadores de célula, preço e GTIN`

### Task 3: Reconhecimento de arquivo e leitura em streaming

**Files:**
- Create: `backend/src/modules/imports/engine/file-sniff.ts`, `backend/src/modules/imports/engine/sheet-reader.ts`
- Test: `backend/src/modules/imports/engine/file-sniff.spec.ts`, `backend/src/modules/imports/engine/sheet-reader.spec.ts`, `backend/src/modules/imports/engine/test-fixtures.ts` (geradores de planilha usados também nas Tasks 5–6)

**Interfaces:**
- Consumes: `cellToText` (Task 2).
- Produces (`file-sniff.ts`):
  - `class ImportFileError extends Error { constructor(public errorCode: 'UNSUPPORTED_FILE' | 'FILE_TOO_LARGE_UNCOMPRESSED' | 'EMPTY_FILE' | 'TOO_MANY_ROWS', message: string) }`
  - `detectFormat(buffer: Buffer): 'xlsx' | 'csv'`
  - `assertSafeZip(buffer: Buffer, limits?: { maxUncompressedBytes: number; maxRatio: number }): void` (padrão 200 MB / 100)
  - `decodeCsv(buffer: Buffer): { text: string; encoding: 'utf-8' | 'windows-1252' }`
  - `detectDelimiter(firstLine: string): ';' | ',' | '\t'`
- Produces (`sheet-reader.ts`):
  - `interface TableSource { format: 'xlsx' | 'csv'; sheetName?: string | null; delimiter?: string | null }`
  - `interface TableRow { rowNumber: number; cells: (string | null)[]; cellErrors: (string | undefined)[] }`
  - `listSheets(buffer: Buffer): Promise<string[]>` (csv ⇒ `[]`)
  - `openTable(buffer: Buffer, source: TableSource): Promise<{ headers: string[]; rows: AsyncIterable<TableRow> }>` — cabeçalho = 1ª linha não vazia; `rows` só as seguintes, pulando linhas totalmente vazias; `rowNumber` = número da linha no arquivo (1-based); `sheetName` inexistente ⇒ `ImportFileError('UNSUPPORTED_FILE', 'A aba "X" não existe na planilha.')`; sem `sheetName` ⇒ 1ª aba.
  - `peekTable(buffer, source, sampleSize = 20): Promise<{ headers: string[]; sample: (string | null)[][] }>` (para de ler após a amostra).
- Produces (`test-fixtures.ts`): `xlsxBuffer(sheets: Record<string, unknown[][]>, opts?: { textColumns?: number[] }): Promise<Buffer>`; `csvBuffer(lines: string[][], opts: { delimiter: string; encoding: 'utf-8' | 'windows-1252'; bom?: boolean }): Buffer`; `zipWithDeclaredSize(uncompressed: number): Buffer` (zip mínimo válido com um arquivo cujo diretório central declara `uncompressed` bytes).

- [ ] **Step 1: Testes que falham**:
  - `detectFormat`: buffer de `xlsxBuffer` ⇒ `'xlsx'`; `csvBuffer` ⇒ `'csv'`; buffer com byte `0x00` nos primeiros 8 KB e sem `PK` ⇒ `ImportFileError` `UNSUPPORTED_FILE` com mensagem `'Formato não suportado. Envie .xlsx ou .csv.'`; buffer vazio ⇒ `EMPTY_FILE` `'O arquivo está vazio.'`.
  - `assertSafeZip`: `zipWithDeclaredSize(300 * 1024 * 1024)` ⇒ `FILE_TOO_LARGE_UNCOMPRESSED` `'A planilha descompactada passa de 200 MB.'`; `xlsxBuffer` normal ⇒ não lança; zip truncado (sem EOCD) ⇒ `UNSUPPORTED_FILE`.
  - `decodeCsv`: `'Descrição'` em Windows-1252 ⇒ `encoding 'windows-1252'`, texto com `ç`/`ã` corretos; UTF-8 com BOM ⇒ `'utf-8'` e sem o `﻿` no texto.
  - `detectDelimiter`: `'a;b;"c,d"'` ⇒ `';'`; `'a,b,c'` ⇒ `','`; `'a\tb'` ⇒ `'\t'`; `'abc'` ⇒ `';'`.
  - `openTable` xlsx: aba 2 escolhida por nome; linhas em branco no meio/fim puladas com `rowNumber` corretos (ex.: cabeçalho na linha 1, dados nas linhas 2 e 4 ⇒ `[2, 4]`); célula numérica `7891234567895` ⇒ `'7891234567895'`; célula de fórmula com `result` ⇒ resultado; célula de erro ⇒ `cells[i] = null` e `cellErrors[i] = 'Célula com erro (#N/A).'`; cabeçalho começando na linha 3 (duas linhas vazias antes) ⇒ `headers` corretos.
  - `openTable` csv: Windows-1252 com `;` e campo entre aspas contendo `;`; UTF-8 com BOM e `,`; linha com menos colunas que o cabeçalho ⇒ `cells` completadas com `null`.
  - `peekTable` com 100 linhas ⇒ `sample.length === 20`.
  - `listSheets` ⇒ nomes na ordem da pasta de trabalho.
- [ ] **Step 2: Rodar e ver falhar** — `npm test -- file-sniff.spec sheet-reader.spec`. Esperado: FAIL.
- [ ] **Step 3: Implementar**:
  - `assertSafeZip`: localizar o EOCD (`0x06054b50`) varrendo de trás para frente os últimos 65 557 bytes; percorrer o diretório central (`0x02014b50`) somando o *uncompressed size* (offset 24, 4 bytes LE); comparar com o limite e com `ratio = total / buffer.length`.
  - xlsx: `new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), { sharedStrings: 'cache', hyperlinks: 'cache', styles: 'ignore', worksheets: 'emit' })`; iterar `for await (const ws of reader)` e usar `ws.name` para escolher a aba (se `name` não estiver disponível no reader, obter os nomes lendo `xl/workbook.xml` e casar pela ordem — o teste de "aba 2 por nome" decide); `for await (const row of ws)` com `row.number` e `row.getCell(i).value` → `cellToText`.
  - csv: `decodeCsv` → `csv-parse` (`delimiter`, `relax_column_count: true`, `bom: true`, `skip_empty_lines: false`) com `info: true` para o número da linha.
  - `listSheets`: para xlsx, pode usar o mesmo reader sem ler linhas, ou `xl/workbook.xml`.
- [ ] **Step 4: Rodar** — `npm test -- file-sniff.spec sheet-reader.spec`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): leitura de xlsx/csv em streaming com proteção contra zip bomb`

### Task 4: Mapeamento sugerido, fingerprint e handler de produtos (parte pura)

**Files:**
- Create: `backend/src/modules/imports/engine/mapping.ts`, `backend/src/modules/imports/handlers/products.import-handler.ts`, `backend/src/modules/imports/handlers/index.ts`
- Modify: `backend/src/modules/imports/engine/types.ts`
- Test: `backend/src/modules/imports/engine/mapping.spec.ts`, `backend/src/modules/imports/handlers/products.import-handler.spec.ts`

**Interfaces:**
- Consumes: normalizadores (Task 2), `priceChangeExceeds` de `approvals/approval-policies.ts`.
- Produces (`types.ts`):
  - `interface ImportFieldDef { key: string; label: string; required: boolean; updatable: boolean; synonyms: string[]; normalize(text: string | null): NormalizeResult }`
  - `interface RowPlan { action: RowAction; diff: Record<string, { from: unknown; to: unknown }> | null; warnings: string[]; sensitivePrice: boolean }`
  - `interface PlanContext { mappedFields: string[]; updateFields: string[]; priceThresholdPercent: number | null }` (`null` = política de preço desligada)
  - `interface MissingPage { items: { id: string; key: string; name: string; hasLosses: boolean }[]; total: number }`
  - `interface ImportResourceHandler<E = unknown> { resource: string; keyField: string; fields: ImportFieldDef[]; loadExisting(manager: EntityManager, keys: string[]): Promise<Map<string, E>>; plan(values: Record<string, unknown>, existing: E | undefined, ctx: PlanContext): RowPlan; countMissing(manager: EntityManager, jobId: string): Promise<{ count: number; withHistory: number }>; listMissing(manager: EntityManager, jobId: string, page: number, limit: number): Promise<MissingPage> }`
- Produces (`mapping.ts`): `normalizeHeader(header: string): string`; `headerFingerprint(headers: string[]): string` (sha256 hex dos normalizados, ordenados, sem vazios, unidos por `\n`); `suggestMapping(headers: string[], fields: ImportFieldDef[]): Record<string, string>` (campo → cabeçalho **original**).
- Produces (handlers): `productsImportHandler: ImportResourceHandler<ExistingProduct>` com `ExistingProduct { id: string; barcode: string; name: string; sku: string | null; unitPrice: number; costPrice: number; isActive: boolean; updatedAt: Date }`; `getImportHandler(resource: string): ImportResourceHandler` (desconhecido ⇒ `BadRequestException` `'Tipo de importação desconhecido.'`).

- [ ] **Step 1: Testes que falham**:
  - `normalizeHeader('  Cód. Barras ') === 'codbarras'`; `normalizeHeader('Preço de Venda') === 'precodevenda'`.
  - `headerFingerprint(['EAN', 'Descrição'])` === `headerFingerprint([' descricao ', 'ean'])`; difere de `headerFingerprint(['EAN'])`.
  - `suggestMapping(['Cód. Barras', 'Descrição', 'Preço de Venda', 'Custo', 'Referência'], fields)` ⇒ `{ barcode: 'Cód. Barras', name: 'Descrição', unitPrice: 'Preço de Venda', costPrice: 'Custo', sku: 'Referência' }`; `['EAN', 'Produto', 'Preço']` ⇒ `{ barcode: 'EAN', name: 'Produto', unitPrice: 'Preço' }`; cabeçalho `'Código'` sozinho vira `sku` e não `barcode`; um cabeçalho nunca é usado por dois campos; os cabeçalhos canônicos do modelo (`Código de barras`, `Nome`, `SKU`, `Preço de venda`, `Custo`) mapeiam todos.
  - `productsImportHandler.fields` tem as chaves `barcode, name, sku, unitPrice, costPrice`, com `required` só em `barcode` e `name`, `updatable` falso só em `barcode`, e sinônimos da spec 2.1.
  - `plan` (sem `existing`) ⇒ `create`, `diff` com todos os campos mapeados (preço não informado ⇒ `to: 0`).
  - `plan` com existente ativo e `updateFields = ['unitPrice']`, nome diferente e preço igual ⇒ `unchanged` (nome não conta); preço diferente ⇒ `update` com `diff = { unitPrice: { from: 10, to: 12 } }`.
  - existente arquivado ⇒ `reactivate` (mesmo sem diferença nos campos), `diff` com `isActive: { from: false, to: true }` + os campos que mudam.
  - preço não informado (`null`) em existente ⇒ campo não entra no diff mesmo estando em `updateFields`.
  - avisos: 10 → 15 ⇒ `PRICE_JUMP`; 10 → 0 ⇒ `PRICE_JUMP`; 0 → 5 ⇒ sem aviso; custo 12 com preço 10 ⇒ `COST_ABOVE_PRICE`; custo final vindo do existente (custo não mapeado) também conta.
  - `sensitivePrice`: limite 20 e 10 → 13 ⇒ true; `priceThresholdPercent null` ⇒ false; preço fora de `updateFields` ⇒ false.
- [ ] **Step 2: Rodar e ver falhar** — `npm test -- mapping.spec products.import-handler.spec`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `mapping.ts` (normalização: NFD sem diacríticos, minúsculas, remove tudo que não é `[a-z0-9]`; sinônimos comparados com a mesma normalização; ordem de prioridade dos campos: `barcode, name, unitPrice, costPrice, sku`; o sinônimo `codigo` pertence só ao `sku`) e o handler (`plan` puro; `loadExisting` com `SELECT … WHERE barcode = ANY($1)` via `manager.query`, números convertidos com `Number`; `countMissing`/`listMissing` com `NOT EXISTS (SELECT 1 FROM import_rows r WHERE r."jobId" = $1 AND r.key = p.barcode AND r.action <> 'error')` sobre `products p WHERE p."isActive"`; `hasLosses` = `EXISTS` em `losses`).
- [ ] **Step 4: Rodar** — `npm test -- mapping.spec products.import-handler.spec`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): sugestão de mapeamento e handler de produtos`

### Task 5: Upload, prévia e mapeamentos salvos (HTTP)

**Files:**
- Create: `backend/src/modules/imports/import-jobs.service.ts`, `backend/src/modules/imports/import-jobs.controller.ts`, `backend/src/modules/imports/import-mappings.service.ts`, `backend/src/modules/imports/import-mappings.controller.ts`, `backend/src/modules/imports/dto/import-mapping.dto.ts`, `backend/src/test-utils/imports-test-app.ts`
- Modify: `backend/src/modules/imports/imports.module.ts`
- Test: `backend/src/modules/imports/import-upload.http.int-spec.ts`, `backend/src/modules/imports/import-mappings.http.int-spec.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `IMPORTS_QUEUE = 'imports'` e `interface ImportQueueData { jobId: string; companyId: string; runId: string }` (em `import-jobs.service.ts`).
  - `ImportJobsService.upload(file: Express.Multer.File, resource: string): Promise<UploadResult>` com `UploadResult { job: ImportJob; sheets: string[]; headers: string[]; sample: (string | null)[][]; suggestedMapping: Record<string, string>; matchedMapping: { id: string; name: string } | null; duplicateOf: { jobId: string; fileName: string; appliedAt: string | null; createdByName: string | null } | null; fields: { key: string; label: string; required: boolean; updatable: boolean }[] }`.
  - `ImportJobsService.preview(id: string, sheetName: string): Promise<Omit<UploadResult, 'job' | 'sheets' | 'duplicateOf' | 'fields'>>` (só em `uploaded`, `simulated` ou `failed` sem `appliedAt`; senão 409 `INVALID_STATE`).
  - `ImportJobsService.findOne(id: string): Promise<ImportJob>` (404 `'Importação não encontrada.'`).
  - `ImportMappingsService.list(resource)`, `.save({ resource, name, mapping, headers })` (upsert por nome, grava `headerFingerprint`), `.remove(id)`, `.findByFingerprint(resource, fingerprint)`, `.touch(id)`.
  - `startImportsApp(): Promise<{ app; baseUrl; storage: FakeStorage; queue: FakeQueue }>` em `imports-test-app.ts` — `FakeStorage` (Map em memória com `uploadBuffer`/`downloadBuffer`) e `FakeQueue` (`add(name, data, opts)` guarda em `calls`); reusa `tokenFor`, `seedUser` de `approvals-test-app.ts`; helper `uploadFile(baseUrl, token, buffer, fileName, resource = 'products')` com `FormData`/`Blob`.

- [ ] **Step 1: Testes que falham** (`import-upload.http.int-spec.ts`):
  - xlsx com `['Cód. Barras','Descrição','Preço de Venda','Custo']` + 30 linhas ⇒ 201; `job.status 'uploaded'`, `format 'xlsx'`, `fileHash` 64 hex, `createdByUserId` = gerente; `sample.length 20`; `suggestedMapping` com os 4 campos; `fields` com 5 itens; arquivo salvo no `FakeStorage` na chave `job.storageKey`.
  - CSV Windows-1252 `;` ⇒ `format 'csv'`, `encoding 'windows-1252'`, `delimiter ';'`, `headers` com `'Descrição'` correto.
  - arquivo `.txt` binário ⇒ 400 `UNSUPPORTED_FILE`; zip bomb ⇒ 400 `FILE_TOO_LARGE_UNCOMPRESSED`; sem arquivo ⇒ 400 `'Nenhum arquivo enviado (campo "file").'`; `resource=users` ⇒ 400 `'Tipo de importação desconhecido.'`; > 20 MB ⇒ 413 ou 400 (limite do multer).
  - mesmo hash de um job `completed` da empresa ⇒ `duplicateOf` preenchido; de **outra** empresa ⇒ `null`.
  - mapeamento salvo com fingerprint igual ⇒ `matchedMapping` e `suggestedMapping` = o salvo.
  - funcionário ⇒ 403.
  - `POST /imports/:id/preview { sheetName: 'Aba2' }` ⇒ cabeçalhos da aba 2 e grava `sheetName`; aba inexistente ⇒ 400 `UNSUPPORTED_FILE`.
  - `GET /imports/:id` de outra empresa ⇒ 404.
  - (`import-mappings.http.int-spec.ts`) `POST /import-mappings { resource, name, mapping, headers }` ⇒ 201; mesmo nome ⇒ substitui (1 linha); `GET /import-mappings?resource=products` lista; `DELETE` ⇒ 204/200 e some; `mapping` com campo desconhecido ⇒ 400 `MAPPING_INVALID`.
- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- import-upload import-mappings`. Esperado: FAIL.
- [ ] **Step 3: Implementar** serviços e controllers (`@Controller('imports')`, `FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } })`; `ImportFileError` ⇒ `BadRequestException({ statusCode: 400, errorCode, message })`; `@Controller('import-mappings')`). No `upload`: `detectFormat` → (`xlsx`) `assertSafeZip` → `listSheets`/`peekTable` → sha256 → busca duplicata (`status = 'completed'`, mais recente) → mapeamento por fingerprint ou `suggestMapping` → `storage.uploadBuffer({ folder: 'imports', ... })` → cria o job. `ImportsModule` registra a fila `imports`, controllers e serviços novos (sem remover os antigos).
- [ ] **Step 4: Rodar** — `npm run test:int -- import-upload import-mappings`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): upload com prévia, sugestão de colunas e mapeamentos salvos`

### Task 6: Simulação (worker) e consultas da simulação

**Files:**
- Create: `backend/src/modules/imports/import-simulator.ts`, `backend/src/modules/imports/imports-queue.processor.ts`, `backend/src/modules/imports/engine/report-csv.ts`, `backend/src/modules/imports/dto/simulate-import.dto.ts`, `backend/src/modules/imports/dto/list-import-rows.dto.ts`
- Modify: `backend/src/modules/imports/import-jobs.service.ts`, `backend/src/modules/imports/import-jobs.controller.ts`, `backend/src/modules/imports/imports.module.ts`
- Test: `backend/src/modules/imports/engine/report-csv.spec.ts`, `backend/src/modules/imports/import-simulation.http.int-spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `loadCompanyPolicies` não serve (depende do contexto HTTP) — o simulador lê `companies."approvalPolicies"` com `normalizePolicies`.
- Produces:
  - `ImportJobsService.simulate(id: string, dto: SimulateImportDto): Promise<ImportJob>` — `SimulateImportDto { sheetName?: string; mapping: Record<string, string>; updateFields: string[]; saveMappingAs?: string }`. Estados aceitos: `uploaded`, `simulated`, `simulating`, `failed` (sem `appliedAt`); senão 409 `INVALID_STATE` `'Esta importação não pode mais ser simulada.'`. Valida (400 `MAPPING_INVALID`): `barcode` e `name` mapeados (`'Mapeie as colunas obrigatórias: Código de barras e Nome.'`), cabeçalho inexistente (`'A coluna "X" não existe na planilha.'`), campo desconhecido, cabeçalho repetido em dois campos, `updateFields` fora dos mapeados ou contendo `barcode`. Grava `mapping`, `sheetName`, `options = { updateFields, runId }`, `status 'simulating'`, zera `summary`/`lastError`, e `afterCommit(() => queue.add('simulate', { jobId, companyId, runId }, { removeOnComplete: 1000, removeOnFail: 1000 }))`.
  - `ImportSimulator.run(data: ImportQueueData): Promise<void>` (construtor `(dataSource: DataSource, storage: StorageService)`).
  - `ImportJobsService.listRows(id, { action?: RowAction | 'warnings'; page = 1; limit = 50 (máx 200) }): Promise<{ items: ImportRowView[]; total: number }>` com `ImportRowView = Pick<ImportRow, 'rowNumber' | 'key' | 'action' | 'normalized' | 'diff' | 'warnings' | 'errors' | 'raw'>`.
  - `ImportJobsService.listMissing(id, page, limit)` ⇒ `MissingPage` (só em `simulated`+).
  - `ImportJobsService.reportCsv(id): Promise<Buffer>` (sem relatório ⇒ 404 `'Relatório ainda não disponível.'`).
  - `buildImportReportCsv(headers: string[], rows: { rowNumber: number | null; key: string | null; action: RowAction; errors: string[]; warnings: string[]; raw: Record<string, string | null> | null; name?: string | null }[]): string` — colunas `Linha;Código de barras;Nome;Situação;Erros;Avisos;` + cabeçalhos originais; situações em português (`Erro`, `Aviso`, `Repetida`); avisos traduzidos: `GTIN_LENGTH_SUSPECT` ⇒ `'Tamanho de código suspeito (zero à esquerda perdido?)'`, `GTIN_CHECK_DIGIT` ⇒ `'Dígito verificador inválido'`, `AMBIGUOUS_DECIMAL` ⇒ `'Separador decimal ambíguo'`, `PRICE_ROUNDED` ⇒ `'Valor arredondado para 2 casas'`, `NAME_TRUNCATED` ⇒ `'Nome cortado em 200 caracteres'`, `PRICE_JUMP` ⇒ `'Variação de preço de 50% ou mais'`, `COST_ABOVE_PRICE` ⇒ `'Custo maior que o preço'`, `DUPLICATE_IDENTICAL` ⇒ `'Linha repetida (ignorada)'`. Exportar o mapa como `WARNING_LABELS` para o painel reusar os textos.

- [ ] **Step 1: Testes que falham**:
  - `report-csv.spec.ts`: BOM + CRLF; cabeçalho exato; linha com erro e célula original `=1+1` sai como `'=1+1`; avisos traduzidos separados por ` | `.
  - `import-simulation.http.int-spec.ts` (o teste chama `new ImportSimulator(dataSource, storage).run(queue.calls[0].data)` depois do `simulate`):
    - planilha com: produto novo; existente com preço mudado; existente arquivado; existente igual; linha sem nome; código repetido idêntico; código repetido com preço diferente; linha em branco no meio ⇒ `simulate` 202 com `status 'simulating'` e **exatamente 1** mensagem na fila **depois** da resposta; após `run`: `status 'simulated'`, `simulatedAt`, `summary.totalRows` = linhas não vazias, `counts` `{ create: 1, update: 1, reactivate: 1, unchanged: 1, error: 2, duplicate: 1 }`; `errorReport` com as 2 linhas; `errorReportKey` no storage; **nenhum produto alterado** (compara `products` antes/depois).
    - `GET /imports/:id/rows?action=update` ⇒ 1 item com `diff.unitPrice`; `action=warnings` ⇒ só linhas com aviso; paginação `limit=2`.
    - `missingCount`: produto ativo fora da planilha conta; arquivado fora não conta; `sensitive.archiveWithHistory` conta o que tem perda (`seedLoss`); `GET /imports/:id/missing` lista com `hasLosses`.
    - política `price_change` ligada (limite 20) e 10 → 13 ⇒ `summary.sensitive.priceChange === 1`; desligada ⇒ 0.
    - `updateFields: ['unitPrice']` sem mapear `costPrice` ⇒ diffs nunca têm `costPrice`/`name`.
    - CSV Windows-1252 `;` com `1.234,56` ⇒ `create` com `unitPrice 1234.56` e nome acentuado correto.
    - `GET /imports/:id/report.csv` ⇒ 200, `text/csv`, contém as linhas com erro.
    - `saveMappingAs: 'ERP X'` ⇒ mapeamento salvo com o fingerprint dos cabeçalhos.
    - validações 400 `MAPPING_INVALID` (obrigatórios, coluna inexistente, `barcode` em `updateFields`); simular job `completed` ⇒ 409 `INVALID_STATE`.
    - **mensagem velha**: simula (runId A), simula de novo (runId B), roda `run` com A ⇒ job continua `simulating` com `options.runId = B` e sem `import_rows` de A; `run` com B ⇒ `simulated`.
    - `simulate` com `sheetName` de uma aba cujo cabeçalho não tem a coluna mapeada ⇒ 400 `MAPPING_INVALID` antes de enfileirar (o serviço lê os cabeçalhos daquela aba com `peekTable`).
    - limite de linhas: `ImportSimulator` recebe `limits?: { maxRows: number }` (padrão 200 000); com `maxRows: 5` e 6 linhas ⇒ `status 'failed'`, `lastError 'A planilha tem mais de 5 linhas.'` (mensagem = `` `A planilha tem mais de ${maxRows.toLocaleString('pt-BR')} linhas.` ``).
- [ ] **Step 2: Rodar e ver falhar** — `npm test -- report-csv.spec` e `npm run test:int -- import-simulation`. Esperado: FAIL.
- [ ] **Step 3: Implementar** o `ImportSimulator.run`:
  1. Transação curta com `app.current_company_id`: carrega o job; se `status !== 'simulating'` ou `options.runId !== data.runId`, termina sem fazer nada. Apaga `import_rows` do job.
  2. Baixa o arquivo, `openTable`; índices das colunas mapeadas pelos `headers`; lê a política de preço de `companies`.
  3. Para cada bloco de 1.000 linhas: normaliza (erros de célula viram erro da linha); resolve repetições com um `Map<key, { rowNumber, normalizedJson }>`; `loadExisting` do handler numa transação curta com o contexto da empresa; `plan`; `INSERT` em lote de `import_rows` (via `unnest` ou `INSERT … VALUES` multilinha parametrizado); acumula contagens/avisos/sensíveis e até 200 erros para o `errorReport`. Antes de cada bloco, confere se o `runId` do job ainda é o mesmo (senão aborta sem gravar mais nada).
  4. Final: `countMissing`; relatório CSV (lê `import_rows` com erro/aviso ordenado por `rowNumber`, em páginas) → `storage.uploadBuffer({ folder: 'imports', contentType: 'text/csv', originalName: 'relatorio.csv' })`; atualiza o job (`summary`, `errorReport`, `errorReportKey`, `status 'simulated'`, `simulatedAt`, `totalRows`, `errorCount`).
  5. Qualquer exceção ⇒ `status 'failed'`, `lastError` = mensagem (`ImportFileError`/`Error`), e loga.
  - `ImportsQueueProcessor` (`@Processor(IMPORTS_QUEUE)`): `process(job)` com `job.name === 'simulate'` ⇒ `simulator.run(job.data)`; outros nomes ⇒ log de aviso (a 3.1.2 acrescenta `apply`).
- [ ] **Step 4: Rodar** — `npm test -- report-csv.spec` e `npm run test:int -- import-simulation`. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(imports): simulação da importação em tabela de preparação`

### Task 7: Fechamento — suíte completa, subida real e documentação

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-sp3-importacao-exportacao-design.md` (seção 9), `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (linha do SP3)

- [ ] **Step 1: Suítes** — `npm test`, `npm run test:int`, `npx tsc --noEmit -p tsconfig.json`, `npm run build`. Esperado: tudo verde; anotar os novos totais (baseline anterior: 24 suítes/166 unit; 28 arquivos/191 integração).
- [ ] **Step 2: Subida real** — backend rodando (`preview_start backend`) com as migrations aplicadas num banco que as tenha (o `inventory_saas` só depois de `pg_dump`); `POST /imports` com um xlsx gerado + `simulate` + `GET /imports/:id` até `simulated` usando o token do gerente de teste; conferir o CSV no MinIO. Esperado: resumo coerente, nenhum produto alterado.
- [ ] **Step 3: Documentar** — seção 9 da spec: o que a 3.1.1 entregou, totais de testes, desvios e menores; mestre: status "3.1.1 concluída".
- [ ] **Step 4: Commit** — `docs: SP3 etapa 3.1.1 concluída`

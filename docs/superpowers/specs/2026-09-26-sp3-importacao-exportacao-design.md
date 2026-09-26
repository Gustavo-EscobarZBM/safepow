# SP3 — Importação 2.0 e exportação (spec)

Data: 2026-09-26
Status: **aprovado pelo usuário em 2026-09-26** (design apresentado em 4 seções, todas aceitas; o usuário
autorizou seguir direto para planos e execução).
Mestre: [desenho mestre, seção SP3](2026-09-20-cadastros-2-0-design-mestre.md) · corrige **F9** (a–g) e completa a
parte de importação da **A3/F5** (lotes com transação própria).

## 0. Decisões desta rodada

| ID | Decisão |
|---|---|
| I1 | Fixtures **sintéticas** (não há planilhas reais de clientes); sinônimos genéricos de ERPs brasileiros. |
| I2 | Com política de aprovação que se aplica, a **importação inteira vira 1 pedido** (não pedidos por linha). |
| I3 | Motor com **tabela de preparação** `import_rows` (abordagem A): o arquivo é lido uma vez; simulação completa e paginável; base da reversão. |
| I4 | Categoria/fornecedor ficam para o SP4; o SP3 importa código de barras, nome, SKU, preço de venda e **custo**. O motor é genérico para o SP4/SP7 plugarem handlers. |
| I5 | D6 aprovado para o SP3: dependências `csv-parse` e `iconv-lite`. |
| I6 | Exportação por **streaming** (sem job assíncrono), limite 200 mil linhas — diverge do mestre (job acima de 20 mil). |
| I7 | Reversão usa `import_rows.before` (não há tabela `import_changes`); vale 30 dias. |
| I8 | GTIN de 12 dígitos **não** é "tamanho suspeito" (é UPC-A); suspeitos: 7 e 11 — diverge do mestre. |

## 1. Estados e modelo de dados

```
uploaded ──simulate──► simulating ──► simulated ──apply──┬─► applying ──► completed ──rollback──► rolling_back ──► rolled_back
   ▲                                     │                └─► pending_approval ──aprovado──► applying
   └──────────── (novo simulate) ────────┘                           └─ recusado/vencido/cancelado ─► cancelled
qualquer fase de trabalho ──► failed (applying que falha pode ser retomado: retry)
```

### 1.1 `import_jobs` (existente, migration aditiva)
Status novos no enum: `uploaded`, `simulating`, `simulated`, `pending_approval`, `applying`, `cancelled`,
`rolling_back`, `rolled_back` (os antigos `pending`/`processing`/`completed`/`failed` continuam; `pending`/
`processing` deixam de ser usados). `ALTER TYPE … ADD VALUE` fora de transação (`transaction = false` na migration).

Colunas novas (todas anuláveis ou com default):
- `resource varchar(40) NOT NULL DEFAULT 'products'`
- `fileHash char(64)`, `format varchar(10)` (`xlsx`/`csv`), `encoding varchar(20)`, `delimiter varchar(4)`,
  `sheetName varchar(120)`, `headers jsonb` (array de strings), `sheets jsonb`
- `mapping jsonb` (campo → cabeçalho), `options jsonb` (`{ updateFields: string[], archiveMissing: boolean,
  confirmArchiveCount?: number }`)
- `summary jsonb` (contagens por ação, avisos por código, `missingCount`, `sensitive: { priceChange, archiveWithHistory }`,
  `appliedCount`, `rolledBackCount`, `conflictCount`)
- `errorReportKey varchar(500)` (CSV completo no storage)
- `createdByUserId uuid NULL REFERENCES users ON DELETE SET NULL`, `changeRequestId uuid NULL`
- `simulatedAt`, `appliedAt`, `rolledBackAt timestamptz NULL`
- `lastError text NULL` (mensagem de falha fatal; `errorReport` continua para as ≤ 200 linhas exibidas)

Índice `(companyId, createdAt DESC)` para o histórico.

### 1.2 `import_rows` (nova)
```
id bigserial PK
companyId uuid NOT NULL           -- RLS (A6, predicado com NULLIF)
jobId uuid NOT NULL REFERENCES import_jobs ON DELETE CASCADE
rowNumber int NULL                -- linha na planilha; NULL para "archive" (ausentes)
raw jsonb NULL                    -- texto original das colunas mapeadas (cabeçalho → texto)
normalized jsonb NULL             -- valores normalizados (campo → valor)
key varchar(64) NULL              -- código de barras normalizado
action varchar(12) NOT NULL       -- create|update|reactivate|unchanged|error|duplicate|archive
diff jsonb NULL                   -- { campo: { from, to } } previsto na simulação
warnings text[] NOT NULL DEFAULT '{}'   -- códigos (GTIN_LENGTH_SUSPECT, PRICE_JUMP…)
errors text[] NOT NULL DEFAULT '{}'     -- mensagens em português
productId uuid NULL
before jsonb NULL                 -- produto antes da gravação (preenchido na gravação)
appliedAction varchar(12) NULL    -- ação efetivamente aplicada (pode diferir da simulada)
appliedUpdatedAt timestamptz NULL -- updatedAt gravado pela importação (detecção de conflito na reversão)
appliedAt timestamptz NULL
rolledBackAt timestamptz NULL
```
Índices: `(jobId, action, rowNumber)`, `(jobId, rowNumber)`, `(jobId, key)`.
Política RLS com `TENANT_COMPANY_ID_PREDICATE` (USING e WITH CHECK), `FORCE`, `GRANT` ao `inventory_saas_app`.

### 1.3 `import_mappings` (nova)
`id uuid`, `companyId`, `resource varchar(40)`, `name varchar(80)`, `mapping jsonb`, `headerFingerprint char(64)`,
`createdByUserId`, `createdAt`, `lastUsedAt`. Único `(companyId, resource, name)`; índice
`(companyId, resource, headerFingerprint)`. RLS como acima. O `products.sourceColumnMapping` deixa de ser
preenchido (coluna fica; F9g).

### 1.4 Histórico de preço
O CHECK de `product_price_history.source` ganha `import_rollback`.

### 1.5 Concorrência e limpeza
- **Uma importação ativa por empresa:** `apply`/`retry`/`rollback` recusam com 409 `IMPORT_IN_PROGRESS` se outro
  job da empresa está em `simulating`, `applying`, `pending_approval` ou `rolling_back`. Checado com
  `pg_advisory_xact_lock(hashtext('imports:' || companyId))` para não haver corrida entre duas confirmações.
- **Limpeza diária** (job repetível do BullMQ): apaga `import_rows` de jobs com mais de 30 dias e marca
  `summary.rowsPurged = true`; jobs `uploaded`/`simulated` parados há mais de 7 dias viram `cancelled`.

## 2. Processamento

### 2.1 Upload — `POST /imports` (síncrono)
- Multipart `file` + `resource` (só `products` por enquanto). Limite **20 MB**.
- Tipo pelo conteúdo: começa com `PK\x03\x04` ⇒ xlsx; senão tem de ser texto (sem bytes NUL nos primeiros
  8 KB) ⇒ csv. Extensão/MIME só como dica.
- **Zip bomb:** helper próprio lê o *End of Central Directory* e soma os tamanhos descompactados do diretório
  central; > **200 MB** ou razão de compressão > 100 ⇒ 400 `FILE_TOO_LARGE_UNCOMPRESSED`.
- xlsx: `exceljs` `WorkbookReader` (streaming) lê a lista de abas e, da aba escolhida (1ª por padrão), o
  cabeçalho (1ª linha não vazia) e **20 linhas de amostra**.
- csv: codificação = UTF-8 se o buffer for UTF-8 válido (BOM removido), senão Windows-1252 (`iconv-lite`);
  delimitador = o mais frequente entre `;`, `,`, `\t` na primeira linha fora de aspas (empate ⇒ `;`);
  `csv-parse` com `relax_column_count`.
- SHA-256 do arquivo; se existe job `completed` da empresa com o mesmo hash, a resposta traz
  `duplicateOf: { jobId, fileName, appliedAt, createdByName }` (aviso, não bloqueia).
- **Mapeamento sugerido:** mapeamento salvo com o mesmo `headerFingerprint` (SHA-256 dos cabeçalhos
  normalizados, ordenados) ⇒ usa e devolve `matchedMapping: { id, name }`; senão, sinônimos (comparação sem
  acento, minúscula, sem pontuação/espaços):
  - `barcode`: codigo de barras, cod barras, codbarras, ean, gtin, ean13, codigo ean, barcode
  - `name`: nome, descricao, descricao do produto, produto, nome do produto
  - `sku`: sku, codigo interno, cod interno, referencia, ref, codigo do produto, codigo
  - `unitPrice`: preco de venda, preco venda, venda, preco, valor de venda, vlr venda, pvenda, preco unitario
  - `costPrice`: custo, preco de custo, valor de custo, vlr custo, pcusto, custo unitario
  - Cada cabeçalho é usado por no máximo um campo (ordem: barcode, name, unitPrice, costPrice, sku).
- Grava o arquivo no storage, cria o job `uploaded` com `headers`, `sheets`, `format`, `encoding`, `delimiter`,
  `fileHash`, `createdByUserId`.

### 2.2 Normalização (funções puras, testadas por tabela)
- **Célula xlsx → texto:** fórmula ⇒ `result` (resultado de erro ⇒ erro na linha); texto rico ⇒ concatenação
  dos `richText`; hiperlink ⇒ `text`; data ⇒ ISO `YYYY-MM-DD`; número inteiro ⇒ `BigInt`/`toFixed(0)` sem
  notação científica; número com fração ⇒ `String(n)`; célula de erro (`{ error }`) ⇒ erro na linha.
- **Código de barras:** apara; se só tiver dígitos e separadores (espaço, `.`, `-`), remove os separadores;
  com letras, mantém como está. Vazio ⇒ erro "Código de barras vazio."; > 64 ⇒ erro. Só dígitos: tamanho 7 ou
  11 ⇒ aviso `GTIN_LENGTH_SUSPECT`; tamanho 8/12/13/14 com dígito verificador inválido ⇒ aviso `GTIN_CHECK_DIGIT`.
- **Preço/custo:** vazio ⇒ "não informado" (em produto novo vira 0; em existente não altera o campo). Remove
  `R$`, espaços (inclusive NBSP). Com `.` e `,`: o separador que aparece por último é o decimal, o outro é de
  milhar. Só `,`: se aparecer uma vez, decimal; mais de uma, milhar. Só `.`: uma vez ⇒ decimal (com exatamente 3
  dígitos depois ⇒ aviso `AMBIGUOUS_DECIMAL`); mais de uma ⇒ milhar. Não numérico ⇒ erro "Preço inválido: "x"."
  Negativo ⇒ erro. Mais de 2 casas ⇒ arredonda (meio para cima) com aviso `PRICE_ROUNDED`. ≥ 10^10 ⇒ erro.
- **Nome:** apara, colapsa espaços; vazio ⇒ erro; > 200 ⇒ trunca com aviso `NAME_TRUNCATED`.
- **SKU:** apara; vazio ⇒ `null`; > 60 ⇒ erro.

### 2.3 Simulação — worker `imports:simulate`
Entrada: `POST /imports/:id/simulate { sheetName?, mapping, updateFields, saveMappingAs? }` ⇒ valida (campos
obrigatórios `barcode` e `name` mapeados; cabeçalhos existem; `updateFields` ⊆ campos mapeados, exceto
`barcode`), apaga `import_rows` anteriores do job, grava `mapping`/`options`, status `simulating`, enfileira, 202.
`saveMappingAs` cria/atualiza o mapeamento salvo (mesmo nome ⇒ substitui).

Worker (transação curta por bloco, `app.current_company_id` do job):
1. Lê o arquivo em streaming; linhas totalmente vazias são ignoradas; > **200 mil linhas** ⇒ `failed` com
   "A planilha tem mais de 200 mil linhas."
2. Em blocos de 1.000: normaliza; pré-carrega `products` por `barcode = ANY($1)` (inclui arquivados); para cada
   linha válida calcula a ação contra o produto e contra as linhas já vistas no arquivo:
   - repetição com `normalized` idêntico ⇒ `duplicate` + aviso `DUPLICATE_IDENTICAL` (ignorada);
   - repetição com dados diferentes ⇒ `error` "Código repetido na linha N com dados diferentes.";
   - não existe ⇒ `create`; existe arquivado ⇒ `reactivate`; existe ativo com diferença nos `updateFields` ⇒
     `update`; sem diferença ⇒ `unchanged`.
   - `diff` só com os `updateFields` (e, em `create`, todos os mapeados).
   - Avisos: `PRICE_JUMP` (preço ou custo variando ≥ 50% sobre um anterior > 0, ou indo a 0 a partir de > 0);
     `COST_ABOVE_PRICE` (custo final > preço final, ambos > 0).
   - Marca sensibilidade: `priceChange` quando `priceChangeExceeds` (SP2) com o limite da política.
3. As chaves já vistas ficam num `Map` em memória (200 mil chaves ≈ poucos MB) para detectar repetição.
4. Ao final: `missingCount` = produtos ativos da empresa cujo `barcode` não está entre as chaves do arquivo
   (consulta com `NOT EXISTS` contra `import_rows` do job); `archiveWithHistory` = quantos desses têm perdas;
   gera o **CSV de erros/avisos** (linha, código de barras, nome, ação, erros, avisos + colunas originais; mesma
   proteção contra fórmula do CSV da auditoria; BOM UTF-8; `;`) e sobe para o storage; `errorReport` recebe as
   primeiras 200 linhas com erro; `summary`; status `simulated`, `simulatedAt`.
5. Falha fatal (arquivo ilegível, aba sumiu, cabeçalho mapeado não existe) ⇒ `failed` + `lastError`.

### 2.4 Confirmação — `POST /imports/:id/apply { archiveMissing, confirmArchiveCount?, justification? }`
1. Job precisa estar `simulated` (senão 409 `INVALID_STATE`); trava de concorrência (1.5).
2. `archiveMissing` e `missingCount` > 20% dos produtos ativos ⇒ exige `confirmArchiveCount === missingCount`
   (senão 409 `ARCHIVE_CONFIRMATION_REQUIRED` com o número).
3. Políticas da empresa (`loadCompanyPolicies`): sensível se `price_change.enabled` e `summary.sensitive.priceChange > 0`,
   ou `archive_with_history.enabled` e `archiveMissing` e `summary.sensitive.archiveWithHistory > 0`. Sensível ⇒
   `applyApprovalGate` com `policy` = `price_change` se houver mudança de preço sensível, senão
   `archive_with_history`; `entityType 'import_job'`, `entityId` = job, `entityLabel` = nome do arquivo,
   `operation 'import'`, `payload = options`, `snapshot = { jobId, simulatedAt, counts }`.
   - Sem justificativa ⇒ 409 `JUSTIFICATION_REQUIRED` (o painel já sabe lidar — `useApprovalFlow`).
   - Modo justificativa (1 gerente) ⇒ segue e grava (a justificativa fica no evento `justify`).
   - Modo aprovação ⇒ job `pending_approval` com `changeRequestId`; resposta `{ status: 'pending', changeRequestId }`.
4. Não sensível (ou modo justificativa) ⇒ status `applying`, enfileira `imports:apply`, 202.

**Aprovação** (`ApprovalsService.apply`, caso `import_job.import`): `currentSnapshot` = job com lock, igual ao
pedido se ainda `pending_approval` com o mesmo `simulatedAt`; aplicar = status `applying` + enfileirar. Recusa,
vencimento e cancelamento do pedido ⇒ o job vira `cancelled` (recusa/cancelamento no próprio serviço; vencimento
por reconciliação preguiçosa ao ler o job ou listar importações).

**Enfileirar dentro da transação:** o worker pode começar antes do commit. Todo worker relê o job e, se o
status ainda não é o esperado (`applying`/`simulating`/`rolling_back`), lança um erro "não pronto" e o BullMQ
tenta de novo (`attempts: 5`, backoff exponencial de 1 s). Status diferente e terminal ⇒ termina sem fazer nada.

### 2.5 Gravação — worker `imports:apply`
Contexto por lote: `app.current_company_id`, `app.current_user_id` = autor do job (o histórico de preço
registra quem importou), `app.change_source = 'import'`, `app.audit_mode = 'summary'`, `app.audit_source = 'import'`.
1. Se `archiveMissing`: recalcula os ausentes; se forem mais que `confirmArchiveCount` (quando exigido) ⇒ `failed`
   com "O número de produtos ausentes mudou (era N, agora M). Simule de novo." **antes** de gravar qualquer coisa.
2. Lotes de **500** linhas `action IN (create, update, reactivate, unchanged)` com `appliedAt IS NULL`, por
   `rowNumber`; **cada lote numa transação**:
   - relê os produtos do lote por `barcode = ANY` com `FOR UPDATE`;
   - recalcula a ação contra o estado atual (o catálogo pode ter mudado); o que ficou sem diferença vira
     `unchanged` (sem escrita);
   - grava `before` (produto inteiro relevante: `name, sku, unitPrice, costPrice, isActive, updatedAt`);
   - `INSERT INTO products (...) SELECT … FROM unnest($1::text[], …) ON CONFLICT ("companyId", barcode) DO UPDATE
     SET <só updateFields>, "isActive" = true, "updatedAt" = clock_timestamp() RETURNING id, barcode, "updatedAt"`;
   - atualiza `import_rows` do lote (`productId`, `appliedAction`, `appliedUpdatedAt`, `appliedAt`) e
     `summary.appliedCount` no job (progresso).
3. Ausentes (se marcados), em lotes de 500: `UPDATE products SET "isActive" = false, "updatedAt" = clock_timestamp()`
   com `before`, inserindo linhas `action = 'archive'` (`rowNumber NULL`).
4. Final: status `completed`, `appliedAt`, evento de auditoria resumido (`import`, com contagens e
   `changeRequestId` se houve). Falha num lote ⇒ os lotes anteriores ficam; job `failed` + `lastError`;
   `POST /imports/:id/retry` volta para `applying` e continua das linhas sem `appliedAt`.
5. O endpoint antigo `POST /products/import` (etapa 3.1 apenas): converte o `ColumnMappingDto` em `mapping`,
   cria o job, simula e, ao terminar a simulação, aplica automaticamente (flag `options.autoApply`), com
   `updateFields` = campos mapeados. Como o endpoint antigo não tem como enviar justificativa, uma importação
   automática que cai em política termina em `simulated` com
   `lastError = "Esta importação precisa de justificativa/aprovação. Use a nova tela de importação."`.
   `GET /products/import/:id` devolve o job no formato antigo (`status` mapeado: `simulating`/`applying` ⇒
   `processing`, `simulated`/`pending_approval`/`cancelled` ⇒ `failed` com a mensagem). Removidos na 3.2.

### 2.6 Reversão — `GET /imports/:id/rollback-preview`, `POST /imports/:id/rollback { justification? }`
- Só `completed` com `appliedAt` há ≤ 30 dias e linhas não expurgadas; trava de concorrência.
- Prévia: por linha aplicada (`appliedAction ∈ create, update, reactivate, archive`), conflito se o produto atual
  tem `updatedAt <> appliedUpdatedAt`; devolve contagens `{ restore, conflicts }` e as linhas em conflito
  (paginadas).
- Políticas: igual à 2.4 (preço voltando além do limite / arquivamento de produtos com perdas), `operation 'rollback'`.
- Worker `imports:rollback` (lotes de 500, `change_source = 'import_rollback'`, trava `FOR UPDATE`, reconfere o
  conflito no momento): `create` ⇒ arquiva; `update` ⇒ restaura `name, sku, unitPrice, costPrice` do `before`;
  `reactivate` ⇒ arquiva; `archive` ⇒ reativa. Marca `rolledBackAt`; job `rolled_back` com
  `summary.rolledBackCount/conflictCount`; evento de auditoria `rollback`.

## 3. API

Todas: `JwtAuthGuard`, `SubscriptionGuard`, `RolesGuard` com `manager`.

| Rota | Resposta |
|---|---|
| `POST /imports` | `{ job, sheets, headers, sample: string[][], suggestedMapping, matchedMapping?, duplicateOf? , fields }` (`fields` = definição dos campos do handler: chave, rótulo, obrigatório) |
| `POST /imports/:id/preview { sheetName }` | `{ headers, sample, suggestedMapping, matchedMapping? }` (só em `uploaded`/`simulated`/`failed` sem gravação) |
| `POST /imports/:id/simulate` | 202 `{ job }` |
| `GET /imports/:id` | job (com reconciliação de pedido vencido) |
| `GET /imports?resource=&page=&limit=` | `{ items, total }` com `createdByName` |
| `GET /imports/:id/rows?action=&page=&limit=` | `{ items, total }`; `action` aceita `warnings` (linhas com aviso) |
| `GET /imports/:id/missing?page=&limit=` | `{ items: [{ id, barcode, name, hasLosses }], total }` |
| `GET /imports/:id/report.csv` | stream do CSV do storage |
| `POST /imports/:id/apply` | 202 `{ job }` ou 202 `{ status: 'pending', changeRequestId, job }` |
| `POST /imports/:id/retry` · `POST /imports/:id/cancel` | `{ job }` |
| `GET /imports/:id/rollback-preview` · `POST /imports/:id/rollback` | prévia · 202 `{ job }` / pendente |
| `GET /import-mappings?resource=` · `POST` · `DELETE /import-mappings/:id` | mapeamentos |
| `GET /imports/template?resource=products` | `.xlsx` com os cabeçalhos canônicos, coluna A em formato texto (`@`) e uma linha de exemplo |
| `GET /products/export?format=&status=&q=` | stream xlsx/csv |
| `GET /loss-reasons/export`, `GET /loss-locations/export`, `GET /users/export` | stream xlsx/csv |

Erros com `errorCode`: `INVALID_STATE`, `IMPORT_IN_PROGRESS`, `ARCHIVE_CONFIRMATION_REQUIRED`,
`FILE_TOO_LARGE_UNCOMPRESSED`, `UNSUPPORTED_FILE`, `MAPPING_INVALID`, `ROLLBACK_EXPIRED`, `JUSTIFICATION_REQUIRED`.

## 4. Exportação
- Contrato `ExportResourceHandler { resource, columns: { header, value(row) }[], query(filters) }`, escrito com
  `exceljs.stream.xlsx.WorkbookWriter` ou CSV (`;`, BOM UTF-8) direto na resposta; leitura em páginas por keyset
  (`id`) de 2.000 linhas; > 200 mil ⇒ 400 antes de começar (contagem prévia).
- Produtos: `Código de barras`, `Nome`, `SKU`, `Preço de venda`, `Custo`, `Situação` (Ativo/Arquivado). Os 5
  primeiros são os cabeçalhos canônicos do modelo (reimportação sem mapear: estão entre os sinônimos). Coluna do
  código em formato texto; preços como número com 2 casas.
- Motivos/locais: `Nome`, `Situação`, `Criado em`. Usuários: `Nome`, `E-mail`, `Papel`, `Situação`, `Criado em`
  (nada de senha/hash).
- Toda célula de texto que começa com `=`, `+`, `-`, `@`, tab ou CR recebe `'` na frente (xlsx e csv).
- Nome do arquivo: `produtos-AAAA-MM-DD.xlsx`.

## 5. Motor genérico
```ts
interface ImportFieldDef { key: string; label: string; required: boolean; synonyms: string[];
  normalize(text: string | null): { value: unknown; errors: string[]; warnings: string[] } }
interface ImportResourceHandler {
  resource: string; keyField: string; fields: ImportFieldDef[];
  loadExisting(manager, keys: string[], opts: { lock: boolean }): Promise<Map<string, ExistingRecord>>;
  plan(normalized, existing, updateFields): { action; diff; warnings; sensitive };
  applyBatch(manager, rows): Promise<AppliedRow[]>;
  missing(manager, jobId): { count, withHistory, page(...) };
  archive(manager, ids) / restore(manager, row);
}
```
Produtos é o único handler do SP3. O motor (upload, leitura, simulação, gravação, reversão, relatórios) não
conhece `products`.

## 6. Painel web
- **`/cadastros/importacoes`**: histórico (data, arquivo, autor, status, contagens) com ações: abrir, baixar
  relatório, tentar de novo, reverter; botão **Nova importação**.
- **`/cadastros/importacoes/nova`** e **`/cadastros/importacoes/[id]`** (o id retoma o passo certo pelo status):
  1. Arquivo — arrastar/soltar, "Baixar modelo", aviso de planilha repetida.
  2. Colunas — aba; um select por campo (com "— não importar —"); amostra das 20 linhas como vieram
     (texto bruto; os valores normalizados aparecem no passo 3, vindos do backend); caixas "atualizar em produtos existentes"; "Salvar mapeamento como…".
  3. Simulação — progresso; cartões por ação; tabela paginada com filtro por ação/avisos e diff antes → depois;
     total de ausentes com lista; "Baixar relatório (CSV)"; "Voltar e ajustar colunas".
  4. Confirmar — resumo; "Arquivar os N produtos ausentes" (acima de 20%: digitar N); fluxo de justificativa/
     aprovação pelo `useApprovalFlow`; botão vira "Enviar para aprovação" no modo aprovação.
  5. Resultado — progresso (consulta a cada 2 s), contagens, relatório, "Reverter importação".
- **Produtos:** remove o card antigo; botões **Importar** (link) e **Exportar** (menu xlsx/csv com os filtros
  atuais). **Motivos/Locais** (`ResourceTable`/`SimpleCatalogPage`) e **Usuários**: botão Exportar.
- **Aprovações:** pedido `import_job` mostra resumo (contagens e sensíveis) e link "Ver simulação".
- **Menu:** "Importações" em Cadastros. Respostas atrasadas: todo fetch paginado usa o padrão de descartar
  resposta obsoleta já usado nas outras telas.

## 7. Etapas

| Etapa | Conteúdo |
|---|---|
| **3.1.1** | Migrations (1.1–1.4); normalização (2.2); leitores xlsx/csv + zip bomb + sinônimos; upload/preview/simulate (2.1, 2.3); linhas/ausentes/relatório CSV; mapeamentos salvos; handler de produtos. |
| **3.1.2** | Confirmação + aprovações (2.4); gravação em lotes + retry/cancel (2.5); trava de concorrência; limpeza; endpoint antigo pelo motor; histórico `GET /imports`; modelo `.xlsx`; teste de carga 50 mil linhas. |
| **3.2** | Painel: importações + assistente + produtos + aprovações; remove endpoint antigo. |
| **3.3** | Exportação (backend + botões). |
| **3.4** | Reversão (backend + painel). |

Cada etapa: plano próprio → execução com TDD → revisão final por subagente → correção dos Importantes →
merge em `main` + push. Migrations novas só entram no banco de desenvolvimento com backup (`pg_dump`) antes.

## 8. Testes
- **Unitários:** normalizadores (tabelas de casos); GTIN; detecção de codificação/delimitador; sinônimos e
  fingerprint; zip bomb (zip sintético com tamanho declarado enorme); proteção de fórmula; planejamento de ação
  (create/update/reactivate/unchanged/duplicate/erro, `updateFields`, avisos).
- **Fixtures** geradas em código nos testes (exceljs/strings/iconv): vírgula decimal, fórmula, texto rico,
  zeros à esquerda como texto e como número, CSV `;` Windows-1252 com acentos, CSV `,` UTF-8 com BOM, duplicatas
  iguais e diferentes, cabeçalho faltando, aba vazia, linhas em branco.
- **Integração (Postgres real):** RLS de `import_rows`/`import_mappings`; upload → simulate → apply ponta a ponta;
  campos não mapeados intocados; histórico de preço com `source = import` e autor; catálogo mudando entre simulação
  e gravação; falha no meio de lote + retry; 409 de concorrência; gate (justificativa, pedido, aprovação aplica,
  recusa cancela, vencido cancela); arquivar ausentes com confirmação forte e com contagem que cresceu; reversão com
  conflito; limpeza de 30 dias; export em streaming; endpoint antigo; **carga de 50 mil linhas** (tempo registrado
  aqui na seção 9).
- **Web (vitest):** cada passo do assistente, resposta atrasada ao trocar filtro, confirmação forte, fluxo de
  aprovação, botões de exportar.

## 9. Resultados e pendências
(preencher durante a execução)

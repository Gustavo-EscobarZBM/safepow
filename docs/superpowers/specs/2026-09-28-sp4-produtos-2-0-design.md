# SP4 — Produtos 2.0 (desenho)

Status: **rascunho para revisão do usuário** (2026-09-28). Mestre: [2026-09-20-cadastros-2-0-design-mestre.md](2026-09-20-cadastros-2-0-design-mestre.md), seção SP4.

## 0. Objetivo e foco

O SAFEPOW é um sistema de **registro de perdas** vendido como SaaS multiempresa. O SP4 só entra no que melhora
uma de duas coisas:

1. **Achar o produto na hora de registrar a perda** (vários códigos, caixa, etiqueta de balança).
2. **Exatidão e leitura do valor perdido** (custo real, unidade, categoria/fornecedor nos relatórios, cadastro sem
   preço zerado, sem duplicados).

Tudo precisa rodar em hospedagem comercial: configuração por variável de ambiente, nada preso a esta máquina,
extensões de banco disponíveis nos provedores gerenciados, isolamento por empresa (RLS) em toda tabela nova.

## 1. Decisões (aprovadas na conversa de 2026-09-28)

| ID | Decisão |
|---|---|
| P1 | Escopo: 4.1 (sem NCM), 4.2, 4.3 (inteira + aprendizado pelo celular), 4.4, 4.5, 4.6, 4.7. **4.8 fora** (custo; lembrar o usuário no SP6). |
| P2 | NCM **não** entra (o sistema não emite nota/cupom fiscal). |
| P3 | Etiqueta de balança: formatos prontos + "Personalizado" + testador + detecção automática; desligado por padrão. |
| P4 | O celular "aprende" o código da balança (PLU) com as proteções 1–5 (seção 6.5). |
| P5 | Duplicados: o sistema **só sugere**; a junção é sempre confirmada por uma pessoa; nada é apagado. |
| P6 | Edição em massa reaproveita o **motor da importação** (SP3): prévia, aprovação, progresso, auditoria e reversão. |
| P7 | Decodificador de etiqueta escrito em TypeScript (backend/painel) e Dart (app offline), testados contra **o mesmo arquivo de casos**. |
| P8 | Semelhança de nomes com as extensões `pg_trgm` + `unaccent` do Postgres (resolve D6 do mestre para o SP4). |
| P9 | Desenvolvimento no sistema atual (branch por etapa → `main`), com ponto de volta: tag `pre-sp4-apresentacao` e dump `inventory_saas-antes-sp4-20260928-221137.dump`. |

## 2. Etapas (ordem de execução)

| Etapa | Conteúdo | Depende de |
|---|---|---|
| **4.1** | Categorias, marcas, fornecedores; novos campos do produto; foto; relatórios por categoria/fornecedor; app mostra foto e unidade | — |
| **4.2** | Vários códigos de barras + caixa (`pack`) + conferência do código (4.7) | 4.1 |
| **4.4** | Parecidos ao cadastrar, lista de possíveis duplicados, junção (função "mover perdas") | 4.2 |
| **4.3** | Balança: configuração, testador, detecção automática, PLU, leitura no app, aprendizado com proteções 1–5 | 4.2, 4.4 |
| **4.5** | Edição em massa pelo motor da importação | 4.1 |
| **4.6** | Saúde do cadastro (nota, "Corrigir agora" com edição em grade, cartão no dashboard) | 4.1, 4.2, 4.4 |

A 4.4 vem antes da 4.3 porque a proteção 4 (desfazer vínculo corrige perdas) reaproveita a função de mover perdas
criada na junção. Cada etapa pode ser dividida em backend/web/app na hora do plano (como no SP3).

## 3. Etapa 4.1 — Novos dados do produto

### 3.1 Banco
- **`categories`** `(id, companyId, name varchar(80), parentId uuid null → categories, isActive, createdAt, updatedAt)`.
  - Até **3 níveis** (Mercearia › Bebidas › Refrigerantes). Verificado por trigger (`depth ≤ 3`, sem ciclo).
  - Unicidade `(companyId, COALESCE(parentId, '00000000-0000-0000-0000-000000000000'), lower(name))` — índice
    por expressão (NULL não conflita em UNIQUE comum).
- **`brands`** `(id, companyId, name varchar(80), isActive, …)`, único `(companyId, lower(name))`.
- **`suppliers`** `(id, companyId, name varchar(120), taxId varchar(18) null, contactName, phone, email, notes, isActive, …)`,
  único `(companyId, lower(name))`.
- **`products`** ganha:
  - `categoryId`, `brandId`, `supplierId` (uuid null, FK `ON DELETE RESTRICT` — cadastros são arquivados, não apagados);
  - `unit varchar(4) not null default 'UN'` com CHECK em `UN, KG, G, L, ML, CX, PCT, DZ, M`;
  - `isPerishable boolean default false`, `shelfLifeDays int null` (CHECK > 0);
  - `imageUrl varchar(500) null`, `notes text null`;
  - `reviewStatus varchar(10) default 'approved'` CHECK `approved|pending` (usado só no SP6; eixo separado de `isActive`);
  - `costPrice` passa de `numeric(12,2)` para **`numeric(12,4)`** (item fracionado). A cópia congelada do custo na
    perda (`losses`, colunas de valuation) acompanha para `numeric(12,4)`; o valor total continua em 2 casas.
- As três tabelas novas ganham RLS com o helper `src/database/helpers/rls.ts` (predicado com `NULLIF`) e os
  triggers de auditoria do SP2.

### 3.2 Backend
- CRUD de `categories`, `brands`, `suppliers` no padrão do **motor de cadastros** (SP2 2.4): listar/criar/editar/
  arquivar/reativar, histórico. Arquivar categoria com filhas ativas → 409. Só gerente edita.
- Produtos: DTOs de criação/edição aceitam os campos novos; listagem filtra por `categoryId` (inclui subcategorias),
  `brandId`, `supplierId`, `unit`.
- **Foto**: `POST /uploads/product-image` (gerente; JPEG/PNG/WebP, 8 MB), pasta `products/` no storage atual. O painel
  reduz a imagem para no máximo 800 px no navegador antes de enviar (sem dependência nova).
- **Importação/exportação** (handlers do SP3): colunas novas `Categoria` (caminho "Mercearia > Bebidas"),
  `Marca`, `Fornecedor`, `Unidade`, `Perecível`, `Validade (dias)`. Categoria/marca/fornecedor inexistentes são
  **criados** na gravação e aparecem como aviso na simulação ("será criada"). Novos handlers de import/export
  para categorias, marcas e fornecedores.
- **Relatórios**: `GET /losses/reports/by-category` (com nível: raiz ou folha) e `by-supplier`, no mesmo formato
  dos existentes. A perda usa a categoria/fornecedor **atuais** do produto (não congelados) — documentado na tela.

### 3.3 Painel
- Telas `Cadastros › Categorias` (árvore com pai), `Marcas`, `Fornecedores`, sobre o motor de cadastros.
- Formulário do produto com os campos novos, foto com pré-visualização; lista com filtros e miniatura.
- Dashboard: o gráfico de quebra das perdas ganha as dimensões "Categoria" e "Fornecedor".

### 3.4 App
- Sync de produtos passa a trazer `unit`, `imageUrl`, `isPerishable`. SQLite versão 3 (`onUpgrade`).
- Produto encontrado mostra foto (com cache) e unidade; quantidade aceita decimais quando a unidade é `KG, G, L, ML, M`.

## 4. Etapa 4.2 — Vários códigos de barras + conferência (4.7)

### Banco (4.2)
- **`product_barcodes`** `(id, companyId, productId, barcode varchar(64), type varchar(8) CHECK primary|alias|pack,
  packQuantity numeric(12,3) null, createdAt)`.
  - Único `(companyId, barcode)` **nesta tabela** — vira a fonte de verdade da unicidade (vale também para arquivados,
    como hoje: código de arquivado devolve 409 com opção de reativar).
  - CHECK: `type = 'pack'` ⇔ `packQuantity > 0`. Exatamente um `primary` por produto (índice único parcial).
  - `products.barcode` continua como **espelho** do principal (mantido na mesma transação).
- Backfill: uma linha `primary` por produto. Não há risco de conflito: `products(companyId, barcode)` já é único.
- Qualquer mudança nos códigos atualiza `products.updatedAt` (é assim que o sync do app percebe).

### Backend (4.2)
- `GET/POST/DELETE /products/:id/barcodes`, `PATCH …/:barcodeId` (tornar principal, mudar quantidade da caixa).
- Busca por código (`findByBarcode`, `/products/search`, importação) consulta `product_barcodes`.
- Importação: coluna opcional `Outros códigos` (separados por `;`) vira `alias`.
- **Conferência do código (4.7)** — módulo único `gtin.ts`:
  - numérico com 8, 12, 13 ou 14 dígitos → confere o dígito verificador → `valid | invalid`;
  - começa com `2` e tem 13 dígitos → `internal` (uso interno/balança, sem aviso);
  - outros tamanhos ou letras → `not_gtin` (código interno de ERP, sem aviso).
  - `invalid` é **aviso** (formulário, simulação da importação). Configuração da empresa `enforceGtin` (padrão
    desligado) transforma em **bloqueio**.
- Configurações do catálogo por empresa: coluna `companies.catalogSettings jsonb default '{}'`
  (`enforceGtin`, e na 4.3 `scaleLabel`), lida de forma tolerante como `approvalPolicies`.

### Painel (4.2)
- Gaveta "Códigos de barras" no produto: lista, adicionar (tipo, quantidade da caixa), remover, tornar principal;
  aviso de dígito inválido ao digitar.
- Configurações do catálogo (nova página `Cadastros › Configurações`): "Bloquear códigos com dígito inválido".

### App (4.2)
- Tabela local `product_barcodes` (SQLite v4 ou junto com a v3 se as etapas saírem juntas); o sync traz
  `barcodes[]` dentro do produto e substitui os códigos locais daquele produto.
- `findByBarcodeLocal` consulta a tabela. Código de caixa → formulário já com a quantidade (ex.: 12) e o selo
  "Caixa com 12".

## 5. Etapa 4.4 — Duplicados e junção

### 5.1 Nome normalizado
- Migration cria as extensões `pg_trgm` e `unaccent` (`CREATE EXTENSION IF NOT EXISTS`) e a função SQL
  **imutável** `catalog_name_key(text)`:
  - minúsculas, sem acento, pontuação → espaço, espaços repetidos → um;
  - junta número e unidade: `2 L` → `2l`, `500 ML` → `500ml`, `1,5L` → `1.5l`;
  - expande abreviações de mercado de uma lista fixa na função (`refri`→refrigerante, `bisc`→biscoito,
    `choc`→chocolate, `cx`→caixa, `pct`→pacote, `un`→unidade, …; a lista final vai no plano).
- `products.nameKey` = coluna **gerada** a partir de `catalog_name_key(name)` + índice GIN `gin_trgm_ops`. Toda forma de
  gravação (tela, importação, edição em massa, SP6) fica coerente sem código extra.

### 5.2 Pontuação de parecidos
1. **Candidatos** no banco: produtos ativos com `similarity(nameKey) ≥ 0,5` (operador `%`, usa o índice).
2. **Regras no backend** (`duplicate-scoring.ts`, puro e testado por tabela de casos):
   - tamanhos extraídos (`2l`, `600ml`, `1kg`…) diferentes → **descarta**;
   - palavras que diferenciam (lista: zero, diet, light, integral, desnatado, sem lactose, sem açúcar, sabores comuns
     como morango, uva, laranja, limão, chocolate, baunilha…) presentes em um e não no outro → **descarta**;
   - mesma marca +0,1; mesma categoria +0,05;
   - sugere quando a nota final ≥ **0,6**.
- Pares marcados "não são o mesmo produto" ficam em `product_duplicate_dismissals (companyId, productAId, productBId)`
  (A < B) e não voltam.

### 5.3 Onde aparece
- **Ao cadastrar/editar** no painel: `GET /products/similar?name=&brandId=&excludeId=` (com atraso de digitação) →
  aviso "Já existe um produto parecido: X. É o mesmo?" com link para abrir o existente. Não bloqueia.
- **Lista de possíveis duplicados**: `GET /products/duplicates` (paginada, no máximo 200 pares por cálculo; mede-se o
  tempo com 100 mil produtos no plano, como na 1.3.1). Aparece na Saúde do cadastro (4.6) e em
  `Cadastros › Produtos › Possíveis duplicados`.

### 5.4 Junção
- **Prévia** `GET /products/:keepId/merge-preview?ids=…` (até 10 por vez): para cada produto a juntar, número de
  perdas, códigos de barras, códigos de balança, pedidos de aprovação pendentes.
- **Aplicar** `POST /products/:keepId/merge { mergeIds[], justification? }`, numa transação:
  1. **Mover perdas** (`moveLosses(fromIds, toId, mode)` — função reaproveitada na 4.3): `productId` passa para o
     mantido; os valores congelados **não mudam** (`mode = 'keep_values'`). Usa o mesmo caminho autorizado da correção
     retroativa (`app.audit_mode`) para passar pelos triggers de valuation.
  2. Códigos dos juntados viram `alias` do mantido (`pack` continua `pack`).
  3. Códigos de balança (4.3) passam para o mantido.
  4. Juntados são **arquivados** com `mergedIntoId = keepId` (coluna nova em `products`); o histórico de preço de
     cada um fica com ele (somente leitura); o do mantido não muda.
  5. Um evento de auditoria `merge` com as contagens.
- **Aprovação**: nova política opcional `product_merge` (desligada por padrão) no mecanismo do SP2.
- **Perdas offline**: `POST /losses` com produto arquivado que tem `mergedIntoId` → grava no mantido (o celular
  pode ter registrado antes de sincronizar a junção).
- Não há "desfazer junção" automático; o arquivado + `mergedIntoId` + auditoria permitem corrigir à mão.

## 6. Etapa 4.3 — Produto pesável e etiqueta de balança

### 6.1 Formato da etiqueta
- Só **EAN-13 começando com `2`** (faixa de uso interno). QR Code / GS1 DataBar ficam fora.
- Configuração em `companies.catalogSettings.scaleLabel`:
  `{ enabled: false, presetId, prefixes: ['2'], pluStart, pluLength, valueStart, valueLength,
  valueType: 'weight'|'price', decimals }` — posições contadas a partir de 0 na string de 13 dígitos.
- **Formatos prontos** (lista final no plano, com exemplo de cada): código de 4, 5 ou 6 dígitos × peso ou preço;
  "Personalizado" libera os campos.
- **Decodificador** `decodeScaleLabel(code, config) → { plu, weightKg? , price? } | null`: confere tamanho, prefixo e
  dígito verificador do EAN-13; ignora o dígito interno do preço quando o formato tiver.
- **Casos comuns**: `shared/scale-label-cases.json` na raiz do repositório (etiqueta, formato, resultado esperado,
  inclusive casos inválidos). Jest (backend e painel) e `flutter test` leem o mesmo arquivo.

### 6.2 Código na balança (PLU)
- Tabela **`product_scale_codes`** `(id, companyId, productId, code varchar(6), status active|pending|suspended,
  source manual|import|app, requestedByUserId, approvedByUserId, labelImageUrl, createdAt)`.
  - Único `(companyId, code)` entre os `active`. Preparada para ganhar `storeId` no SP8 (PLU pode mudar por loja).
  - Só produtos com unidade **KG** podem ter PLU (pesável = vendido por kg).
- Painel: campo "Código na balança" no produto (aparece quando a unidade é KG); importação ganha a coluna
  `Código balança`.
- Sync do app leva os PLUs ativos dentro do produto.

### 6.3 Perda com etiqueta
- `losses` ganha `scaleLabel varchar(13) null` (a etiqueta lida) e `scaleCodeId uuid null` (o vínculo usado).
- Quantidade: etiqueta de **peso** → quantidade = peso; etiqueta de **preço** → quantidade = preço ÷ preço do kg
  (3 casas). Assim o valor da perda de uma etiqueta de preço bate com o impresso.

### 6.4 Leitura no app (ordem de busca)
1. Código exato em `product_barcodes` (a loja pode ter cadastrado um código fixo começando com 2).
2. Se a balança está ligada e o código decodifica: procura o PLU nos vínculos ativos → formulário já com produto,
   quantidade em kg e selo "Etiqueta de balança" (quantidade não editável).
3. PLU desconhecido → fluxo de aprendizado (6.5).
- A configuração da etiqueta chega ao app por `GET /companies/me/catalog-settings` no login e em cada sync.

### 6.5 Aprendizado pelo celular e proteções
Fluxo: "Etiqueta de balança — código 0123 — 0,850 kg. Qual é este produto?" → busca → escolhe → perda
registrada com o produto escolhido **sempre** (a perda nunca se perde) → vínculo:
- **gerente** no app: vínculo `active` na hora (auditado);
- **funcionário**: vínculo `pending` + pedido na tela **Aprovações** (change request `entityType =
  'product_scale_code'`, `operation = 'link'`), com a foto da etiqueta. Aprovar ativa o vínculo; recusar/expirar
  deixa as perdas como estão.

| # | Proteção | Como |
|---|---|---|
| 1 | Só pesáveis na busca | A busca do aprendizado lista só produtos com unidade KG. |
| 2 | Conferência do valor | Etiqueta de preço: peso implícito = preço ÷ preço do kg fora de **0,01–25 kg** → aviso "O valor da etiqueta não combina com este produto. Tem certeza?". Etiqueta de peso: peso fora da mesma faixa → mesmo aviso. (Proteção forte para etiqueta de preço; para etiqueta de peso só pega pesos absurdos.) |
| 3 | Foto da etiqueta na aprovação | Funcionário precisa tirar a foto da etiqueta para pedir o vínculo; enviada pela fila de sync (funciona offline) para `uploads/scale-label-image`; aparece ao lado do produto escolhido na tela de Aprovações. |
| 4 | Desfazer vínculo corrige as perdas | Painel: "Desfazer vínculo" mostra "N perdas foram registradas com este vínculo" e oferece movê-las para o produto certo com `moveLosses(…, mode = 'rescan')`: a etiqueta guardada é lida de novo com o produto certo — etiqueta de preço mantém o valor e recalcula a quantidade; etiqueta de peso mantém a quantidade e recalcula o valor pelo preço do produto certo **na data da perda** (histórico de preço do SP1). Auditado com antes/depois. |
| 5 | Alerta de formato mal configurado | Se em 24 h chegarem pedidos para **10 ou mais PLUs diferentes** desconhecidos, o servidor **pausa o aprendizado** (`scaleLabel.learningPausedAt`), marca os pedidos seguintes como `suspended` e avisa o gerente (card de alertas + Aprovações): "Muitas etiquetas não reconhecidas — confira o formato da balança no testador". Pausado, o app continua registrando a perda escolhendo o produto, só não cria vínculo. O gerente retoma na página da balança. |

Conflito: se o PLU já estiver ativo em outro produto, o app avisa e não troca (a perda é registrada normalmente).

### 6.6 Painel — página "Balança" (`Cadastros › Balança`)
- Liga/desliga; escolha do formato pronto ou "Personalizado".
- **Testador**: digita ou lê uma etiqueta → mostra PLU, peso/preço e o produto encontrado.
- **Detecção automática**: com uma etiqueta real, tenta todos os formatos prontos e sugere os que acham um produto
  com aquele PLU (e, na etiqueta de preço, peso plausível).
- Lista de vínculos (PLU ↔ produto, origem, quem criou), com "Desfazer vínculo" (proteção 4) e o estado do
  aprendizado (pausado/ativo, botão retomar).

## 7. Etapa 4.5 — Edição em massa

- **Seleção** na lista de produtos: caixas por linha **ou** "todos os N resultados do filtro" (os ids são resolvidos
  na criação do job). Limite **5 000** por operação.
- **Ações**: reajuste de preço de venda ou custo (% ou valor fixo; arredondamento: nenhum, termina em ,99, termina
  em ,90, inteiro para cima — ",99" = parte inteira + 0,99, ex. 10,32 → 10,99); definir categoria, marca,
  fornecedor, unidade; arquivar; reativar.
- **Motor**: `import_jobs` ganha `origin varchar(8) default 'file'` (`file|bulk`); `storageKey` passa a aceitar nulo
  (bulk não tem arquivo); a ação vai em `options.bulk`. Em vez de ler planilha, a "simulação" gera as `import_rows`
  a partir dos produtos selecionados com os valores calculados. Daí para frente é o mesmo caminho do SP3:
  prévia **antes → depois**, políticas `price_change` e `archive_with_history`, gravação em lotes com progresso,
  histórico de preço por item (origem `bulk`), auditoria e **Desfazer** (reversão da 3.4).
- **Painel**: barra de ações em massa na lista de produtos → diálogo da ação → telas existentes do assistente
  (prévia, confirmação, progresso). O histórico de importações mostra "Edição em massa" como tipo.

## 8. Etapa 4.6 — Saúde do cadastro

- `GET /products/health` (só produtos ativos) devolve contagens e a nota:

| Problema | Peso |
|---|---|
| Preço de venda zero | 3 |
| Custo maior que o preço | 2 |
| Código com dígito inválido | 2 |
| Possível duplicado (4.4, sem os descartados) | 2 |
| Pesável (KG) sem código na balança — só com a balança ligada | 1 |
| Custo zero | 1 |
| Sem categoria | 1 |
| Sem fornecedor | 0,5 |
| Pendente de revisão (SP6; zero até lá) | 1 |

  Nota = `100 − 100 × Σ min(3, soma dos pesos do produto) ÷ (3 × produtos ativos)`, arredondada; catálogo vazio = 100.
  Contagem de duplicados limitada ("200+").
- **Página** `Cadastros › Saúde do cadastro`: nota, lista de problemas com contagem e **Corrigir agora**.
- **Corrigir agora** abre a lista de produtos filtrada pelo problema (`?issue=`) em **modo grade**: preço, custo,
  categoria, fornecedor editáveis na célula; Tab/Enter vão para a próxima; salva por linha (PATCH). Se a política
  de preço exigir aprovação, a linha mostra "enviado para aprovação". "Possível duplicado" abre a lista de pares da 4.4.
- **Dashboard**: cartão com a nota e os 3 maiores problemas, levando à página.

## 9. Hospedagem e comercial

- `pg_trgm` e `unaccent` existem nos Postgres gerenciados comuns (AWS RDS, Google Cloud SQL, Azure, Supabase). A
  migration usa `IF NOT EXISTS`; o usuário do banco em produção precisa de permissão para criar extensões (anotar no
  guia de implantação).
- Fotos (produto, etiqueta) usam o storage S3-compatível já configurado por variável de ambiente.
- Nenhuma dependência nova de runtime prevista (redimensionar imagem com canvas no navegador; câmera no app com o
  pacote que já tira a foto da perda — conferir no plano).
- Filas BullMQ: a edição em massa usa a fila da importação (sem fila nova).

## 10. Testes (resumo; detalhes no plano de cada etapa)

- **4.1**: unicidade de categoria com `parentId` nulo; limite de 3 níveis e ciclo; RLS das tabelas novas; importação
  criando categoria/marca/fornecedor; relatórios por categoria/fornecedor; migração do custo para 4 casas sem perder dado.
- **4.2**: unicidade entre principal/alias/pack; espelho `products.barcode`; backfill; busca por alias; sync com
  `barcodes[]`; `gtin.ts` com tabela de casos (válidos, inválidos, internos, 8/12/13/14 dígitos); `enforceGtin`.
- **4.4**: `catalog_name_key` com tabela de casos (acento, "2 L", abreviações); `duplicate-scoring` (Coca 2L × Refri
  Coca-Cola 2 L sugere; × Coca Zero 2L e × Coca 600ml não sugerem); junção move perdas sem mudar valor, cria aliases,
  arquiva com `mergedIntoId`; perda offline para produto juntado; desempenho com 100 mil produtos.
- **4.3**: `scale-label-cases.json` nos dois decodificadores; PLU único entre ativos; fluxo gerente × funcionário;
  proteções 1–5 (inclusive `rescan` de peso e de preço e a pausa com 10 PLUs em 24 h); detecção automática.
- **4.5**: prévia == resultado; arredondamentos; limite de 5 000; aprovação; reversão da edição em massa.
- **4.6**: nota com tabela de casos; filtros `?issue=`; edição em grade (teclado).
- Baselines atuais: backend unit 32/307, int 40/314; web 60/364; app 27.

## 11. Fora do escopo

- 4.8 Consulta automática por código de barras (Cosmos) — adiada pelo custo; lembrar no SP6.
- NCM e qualquer dado fiscal.
- Etiquetas QR Code / GS1 DataBar.
- PLU por loja (SP8; a tabela já está preparada).
- Desfazer junção automaticamente.
- Estoque/movimentação (o sistema só registra perdas).

## 12. Riscos

| Risco | Mitigação |
|---|---|
| Formato da etiqueta varia por loja | Formatos prontos + personalizado + testador + detecção automática; desligado por padrão; alerta de formato (proteção 5). |
| Vínculo PLU errado contamina perdas | Proteções 1–5; perdas com a etiqueta guardada podem ser reprocessadas. |
| Busca de duplicados lenta em catálogo grande | Índice GIN trigram; limite de 200 pares; medir com 100 mil produtos. |
| Mexer em `losses` (colunas de valor) | Mesmo caminho autorizado da correção retroativa; testes de valuation existentes precisam seguir verdes. |
| Sistema em uso durante o desenvolvimento (apresentação 2026-09-29) | Branch por etapa; só entra na `main`/banco depois de verde e revisado; tag + dump de volta. |

## 13. Menores abertos

**Etapa 4.1 (concluída em 2026-09-29)** — divergências em relação a este desenho:
- Importação: o separador de níveis da categoria é só ">" (o "/" faz parte do nome, ex. "Frios/Laticínios"); ">" é
  proibido em nome de categoria.
- Importação reativa categoria/marca/fornecedor arquivado só quando a linha muda aquele campo, com aviso
  `*_WILL_BE_REACTIVATED` na simulação; "Validade" sozinha não é ligada automaticamente aos dias.
- Handlers de importação só de categorias/marcas/fornecedores ficaram de fora (a importação de produtos cria o que falta).
- Foto do produto: reduzida no navegador (lado maior 800 px, JPEG com fundo branco); não há recusa por tamanho no painel.

Menores abertos da 4.1 (revisão final):
- Nome só com espaços em categoria/marca/fornecedor dá 500 (falta trim no DTO).
- API aceita criar/mover categoria para dentro de pai arquivado (o painel já filtra).
- Filtros e coluna Categoria da lista de produtos não marcam "(arquivada)".
- Dashboard sem o aviso "usa a categoria/fornecedor atual do produto" nas abas novas.
- Texto do diálogo de arquivar fica no feminino também para fornecedor.
- Foto no app sem cache em disco (`Image.network`): offline, depois de reabrir o app, some (volta o ícone).
- Histórico mostra "Categoria pai: alterado" também na criação.

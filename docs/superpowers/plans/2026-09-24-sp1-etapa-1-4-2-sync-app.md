# SP1 · Sub-etapa 1.4.2 — Sync correto e migração do SQLite no app — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O app Flutter passa a sincronizar o catálogo pelo contrato da 1.4.1: primeira carga em páginas
com troca atômica, incremental com tombstones (produto arquivado some do celular), cursor do servidor
gravado só no fim; e o SQLite local ganha migração versionada (v2 força um re-sync total, removendo os
"fantasmas" de instalações antigas) sem nunca apagar perdas pendentes.

**Architecture:** `ApiClient.getWithHeaders` devolve corpo + cabeçalhos. `ProductRepository.refreshFromServer`
baixa todas as páginas para a memória (seguindo `X-Next-After`) e só então aplica tudo — catálogo e cursor —
numa única transação SQLite. `AppDatabase` ganha `openAt(path)`, versão 2 e um mapa `_migrations`
(aditivo); o mesmo ponto de abertura permite que cada arquivo de teste use um banco isolado, o que também
conserta a intermitência atual da suíte (todos os arquivos abrem o mesmo arquivo SQLite em paralelo).

**Tech Stack:** Flutter (Dart 3), sqflite + sqflite_common_ffi (testes), package:http (+ `http/testing.dart`
`MockClient`). Flutter em `C:\flutter\bin` (fora do PATH): `C:/flutter/bin/flutter test`, `flutter analyze`.

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md),
seção 6.2 (app), 6.3 (testes do app), R1, R4–R6, RK4/RK5. Contrato do backend: 1.4.1 (mesclada).

## Global Constraints

- **Spec 6.2 (literal):** `ApiClient` ganha um método que devolve **corpo + cabeçalhos**. `refreshFromServer()`:
  **primeira carga** (sem cursor) baixa **todas as páginas para a memória** e só então troca o catálogo de
  uma vez numa transação; **incremental:** `since = cursor − 2 min`, `includeArchived=true`, `limit=5000`,
  segue `X-Next-After`; item com `isActive == false` ⇒ `DELETE` local; senão upsert. Grava o cursor
  (`X-Sync-Cursor`) **só ao final, com tudo aplicado**. Servidor antigo (sem cabeçalho) ⇒ relógio do
  aparelho como hoje. `AppDatabase`: `version: 2`, `onUpgrade` que percorre `_migrations[versão]`,
  **sempre aditivo**; `v2` = apaga `products_last_sync_at` (R6). Sem `onDowngrade` destrutivo (nunca apagar
  `losses`). Ponto de abertura injetável (`openAt(path)`) para teste.
- **Decisão (revisão da 1.4.1, item 4):** numa carga de várias páginas, o cursor gravado é o
  `X-Sync-Cursor` da **primeira** página (o mais antigo — o mais conservador).
- **Primeira carga não pede `includeArchived`** (só ativos interessam para montar o catálogo); ela usa
  `limit=5000` para paginar. Um servidor antigo ignora `limit` e devolve tudo numa página — funciona igual.
- A chave de metadados continua `products_last_sync_at` (a v2 a apaga uma vez; depois ela passa a guardar o
  cursor do servidor) — constante movida para `AppDatabase.productsSyncCursorKey`.
- Backend e web não mudam nesta sub-etapa.
- **Baseline (confirme antes da Task 1):** `flutter test --concurrency=1` = 27 testes passando;
  `flutter test` (paralelo) é **intermitente** hoje (1–2 falhas em `auth_repository_company_isolation_test`
  por causa do banco compartilhado); `flutter analyze` limpo.
- Comandos em `C:\PROJETOS\SAAS\mobile_app` (`cd /c/PROJETOS/SAAS/mobile_app`; `F=C:/flutter/bin/flutter`).
- **Commits:** branch `feat/cadastros-sp1-etapa-1-4-2` a partir de `main`; um commit por tarefa, mensagem
  terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Merge/push só com confirmação.

## Review Focus

1. **Falha no meio da primeira carga** (rede cai na 2ª página): o aparelho continua com o catálogo antigo
   inteiro e sem cursor — nunca sem catálogo offline. → Task 4, teste "falha na 2ª página".
2. **Perda pendente numa instalação v1 que atualiza para v2:** a fila de perdas fica intacta (RK5). →
   Task 2, teste de migração v1→v2 com perda pendente.
3. **Servidor com bug que devolve o mesmo `X-Next-After` de novo:** o app para com erro em vez de ficar em
   loop infinito, e não grava cursor. → Task 4, teste "cursor repetido".
4. **Tombstone e produto novo com o MESMO código de barras** na mesma sincronização (arquivou o antigo,
   cadastrou outro com o código): o índice único local não pode derrubar o sync — aplicar os `DELETE` antes
   dos upserts. → Task 4, teste "tombstone e novo com o mesmo código".
5. **Servidor antigo** (sem cabeçalhos): o sync funciona numa página e grava o relógio do aparelho, como
   hoje. → Task 4, teste "servidor antigo".

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `mobile_app/lib/core/storage/app_database.dart` | modificar | `openAt`, versão 2, `_migrations`, override de caminho para teste, chave do cursor |
| `mobile_app/test/support/isolated_database.dart` | criar | helper: cada arquivo de teste com banco em memória próprio |
| `mobile_app/test/support/v1_schema.dart` | criar | esquema v1 congelado (fixture da migração) |
| `mobile_app/test/core/app_database_migration_test.dart` | criar | v1→v2 com perda pendente; instalação nova |
| `mobile_app/test/data/repositories/*_test.dart` (existentes que usam o banco) | modificar | usar o helper isolado |
| `mobile_app/lib/core/network/api_client.dart` | modificar | `ApiResponse`, `getWithHeaders` |
| `mobile_app/test/core/api_client_headers_test.dart` | criar | corpo + cabeçalhos |
| `mobile_app/lib/data/models/product.dart` | modificar | `isActive` |
| `mobile_app/lib/data/repositories/product_repository.dart` | modificar | sync novo |
| `mobile_app/test/data/repositories/product_repository_sync_test.dart` | criar | testes do sync |

---

### Task 1: Banco isolado por arquivo de teste (conserta a suíte intermitente)

**Files:**
- Modify: `mobile_app/lib/core/storage/app_database.dart`
- Create: `mobile_app/test/support/isolated_database.dart`
- Modify: os testes existentes que abrem `AppDatabase` (descobrir com `grep -rl "AppDatabase\|databaseFactoryFfi" test`)

**Interfaces:**
- Produces: `AppDatabase.openAt(String path): Future<Database>` (estático); `AppDatabase.instance
  .useDatabaseAtForTesting(String path): Future<void>` (`@visibleForTesting`); helper
  `useIsolatedTestDatabase(): Future<void>` em `test/support/isolated_database.dart`.

**Por que não há teste RED clássico:** a falha é de concorrência entre arquivos de teste (dois isolates do
`flutter test` abrindo o mesmo arquivo SQLite); ela é demonstrada pela própria suíte em paralelo, que falha
de forma intermitente hoje. A prova de correção é a suíte paralela verde em **3 execuções seguidas**.

- [ ] **Step 1: Branch e baseline**

```bash
cd /c/PROJETOS/SAAS && git checkout main && git checkout -b feat/cadastros-sp1-etapa-1-4-2
cd mobile_app && F=C:/flutter/bin/flutter
$F test --concurrency=1 2>&1 | tail -1
for i in 1 2 3; do $F test 2>&1 | tail -1; done
$F analyze 2>&1 | tail -1
grep -rl "AppDatabase\|databaseFactoryFfi" test
```
Expected: `+27: All tests passed!` com `--concurrency=1`; pelo menos uma das 3 execuções paralelas com
`Some tests failed`; `No issues found!`; lista dos arquivos de teste que usam o banco.

- [ ] **Step 2: `openAt` e override de caminho**

Modify `mobile_app/lib/core/storage/app_database.dart`:
- import: `import 'package:flutter/foundation.dart';` (para `@visibleForTesting`).
- dentro da classe, depois de `Database? _db;`:
```dart
  String? _pathOverride;

  /// Testes: aponta o singleton para outro banco (ex.: em memória, um por arquivo de teste). Sem isso,
  /// todos os arquivos de teste — que o `flutter test` roda em paralelo — abrem o MESMO arquivo SQLite e
  /// se atropelam.
  @visibleForTesting
  Future<void> useDatabaseAtForTesting(String path) async {
    await _db?.close();
    _db = null;
    _pathOverride = path;
  }
```
- trocar o `_initDb()` inteiro por:
```dart
  Future<Database> _initDb() async {
    final path = _pathOverride ?? join(await getDatabasesPath(), 'inventory_loss_app.db');
    return openAt(path);
  }

  /// Abre (criando ou migrando) o banco do app num caminho qualquer — ponto único de abertura, usado pelo
  /// app e pelos testes de migração.
  static Future<Database> openAt(String path) {
    return openDatabase(path, version: 1, onCreate: _onCreate);
  }
```
- mover o corpo do `onCreate` atual (todos os `CREATE TABLE`/`CREATE INDEX`) para
  `static Future<void> _onCreate(Database db, int version) async { … }`, sem alterar nenhum SQL.

Create `mobile_app/test/support/isolated_database.dart`:
```dart
import 'package:inventory_loss_app/core/storage/app_database.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Cada arquivo de teste roda num isolate próprio; com um banco EM MEMÓRIA por isolate, os arquivos não
/// compartilham mais o mesmo arquivo SQLite (causa da intermitência da suíte em paralelo).
Future<void> useIsolatedTestDatabase() async {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;
  await AppDatabase.instance.useDatabaseAtForTesting(inMemoryDatabasePath);
}
```

- [ ] **Step 3: Usar o helper nos testes existentes**

Em cada arquivo listado no Step 1, trocar as duas linhas do início do `main()`
```dart
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;
```
por
```dart
  setUpAll(useIsolatedTestDatabase);
```
e acrescentar `import '../../support/isolated_database.dart';` (ajustar os `../` à profundidade do arquivo).
Remover o import de `sqflite_common_ffi` se ficar sem uso (o `flutter analyze` acusa).

- [ ] **Step 4: Provar e commit**

```bash
for i in 1 2 3; do $F test 2>&1 | tail -1; done
$F analyze 2>&1 | tail -1
cd /c/PROJETOS/SAAS && git add mobile_app/lib/core/storage/app_database.dart mobile_app/test
git commit -m "test(mobile): banco em memória por arquivo de teste (conserta a suíte intermitente); AppDatabase.openAt" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: as 3 execuções `+27: All tests passed!`; `No issues found!`.

---

### Task 2: SQLite versão 2 com migrações aditivas

**Files:**
- Modify: `mobile_app/lib/core/storage/app_database.dart`
- Create: `mobile_app/test/support/v1_schema.dart`
- Create: `mobile_app/test/core/app_database_migration_test.dart`

**Interfaces:**
- Consumes: `AppDatabase.openAt` (Task 1).
- Produces: `AppDatabase.currentVersion = 2`; `AppDatabase.productsSyncCursorKey = 'products_last_sync_at'`
  (usada pela Task 4).

- [ ] **Step 1: Fixture do esquema v1 e teste (vai falhar)**

Create `mobile_app/test/support/v1_schema.dart` — **cópia congelada** do `onCreate` da versão 1 (o esquema
que os aparelhos instalados têm hoje):
```dart
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Esquema do banco do app na VERSÃO 1 (como está nos aparelhos instalados antes da 1.4.2). Congelado de
/// propósito: o teste de migração abre um banco assim e confere o que a v2 faz com ele.
Future<void> createV1Schema(Database db) async {
  await db.execute('''
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      barcode TEXT NOT NULL,
      sku TEXT,
      name TEXT NOT NULL,
      unitPrice REAL NOT NULL
    )
  ''');
  await db.execute('CREATE UNIQUE INDEX idx_products_barcode ON products(barcode)');
  await db.execute('''
    CREATE TABLE losses (
      clientGeneratedId TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productNameSnapshot TEXT NOT NULL,
      quantity REAL NOT NULL,
      locationId TEXT NOT NULL,
      locationNameSnapshot TEXT NOT NULL,
      reasonId TEXT NOT NULL,
      reasonNameSnapshot TEXT NOT NULL,
      description TEXT NOT NULL,
      localImagePath TEXT,
      uploadedImageUrl TEXT,
      occurredAt TEXT NOT NULL,
      syncStatus TEXT NOT NULL,
      syncAttempts INTEGER NOT NULL DEFAULT 0,
      lastSyncError TEXT,
      lastAttemptAt TEXT
    )
  ''');
  await db.execute('CREATE INDEX idx_losses_sync_status ON losses(syncStatus)');
  await db.execute('CREATE TABLE loss_reasons (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
  await db.execute('CREATE TABLE loss_locations (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
  await db.execute('CREATE TABLE sync_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}
```

Create `mobile_app/test/core/app_database_migration_test.dart`:
```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/core/storage/app_database.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../support/v1_schema.dart';

void main() {
  late Directory dir;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('app_db_migration_');
  });

  tearDown(() async {
    await dir.delete(recursive: true);
  });

  test('v1 → v2: a perda pendente fica intacta e o cursor do catálogo é apagado (re-sync total)', () async {
    final path = '${dir.path}/app.db';
    final v1 = await databaseFactoryFfi.openDatabase(
      path,
      options: OpenDatabaseOptions(version: 1, onCreate: (db, _) => createV1Schema(db)),
    );
    await v1.insert('products', {'id': 'p-1', 'barcode': '111', 'name': 'Fantasma', 'unitPrice': 1.0});
    await v1.insert('losses', {
      'clientGeneratedId': 'loss-pendente',
      'productId': 'p-1',
      'productNameSnapshot': 'Fantasma',
      'quantity': 2.0,
      'locationId': 'l-1',
      'locationNameSnapshot': 'Depósito',
      'reasonId': 'r-1',
      'reasonNameSnapshot': 'Quebra',
      'description': 'caiu',
      'occurredAt': '2026-09-20T10:00:00.000Z',
      'syncStatus': 'pending',
    });
    await v1.insert('sync_metadata', {'key': 'products_last_sync_at', 'value': '2026-09-20T10:00:00.000Z'});
    await v1.insert('sync_metadata', {'key': 'cached_company_id', 'value': 'company-1'});
    await v1.close();

    final v2 = await AppDatabase.openAt(path);

    expect(await v2.getVersion(), AppDatabase.currentVersion);
    expect(AppDatabase.currentVersion, 2);
    final losses = await v2.query('losses');
    expect(losses, hasLength(1));
    expect(losses.first['clientGeneratedId'], 'loss-pendente');
    expect(losses.first['syncStatus'], 'pending');
    final metadata = await v2.query('sync_metadata');
    expect(metadata.map((row) => row['key']), isNot(contains('products_last_sync_at')));
    expect(metadata.map((row) => row['key']), contains('cached_company_id'));
    await v2.close();
  });

  test('instalação nova já nasce na versão atual, com as tabelas do app', () async {
    final db = await AppDatabase.openAt('${dir.path}/novo.db');

    expect(await db.getVersion(), AppDatabase.currentVersion);
    final tables = (await db.rawQuery("SELECT name FROM sqlite_master WHERE type = 'table'"))
        .map((row) => row['name'])
        .toList();
    expect(tables, containsAll(['products', 'losses', 'loss_reasons', 'loss_locations', 'sync_metadata']));
    await db.close();
  });
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `$F test test/core/app_database_migration_test.dart`
Expected: FAIL na compilação — `Member not found: 'currentVersion'`.

- [ ] **Step 3: Implementar**

Modify `mobile_app/lib/core/storage/app_database.dart`:
- constantes no topo da classe:
```dart
  /// Versão do esquema local. Toda mudança entra em `_migrations` — SEMPRE aditiva: nunca apagar a tabela
  /// `losses` (fila offline de perdas ainda não enviadas — RK5). Sem onDowngrade destrutivo.
  static const int currentVersion = 2;

  /// Metadado com o cursor do sync de produtos (o X-Sync-Cursor do servidor; em servidor antigo, o relógio
  /// do aparelho).
  static const String productsSyncCursorKey = 'products_last_sync_at';

  /// Migração de (versão - 1) para `versão`.
  static final Map<int, Future<void> Function(Database db)> _migrations = {
    // v2 (SP1, R6): apaga o cursor do catálogo para forçar UM re-sync total na primeira abertura depois de
    // atualizar — remove os "fantasmas" (produtos arquivados antes da correção que ficaram no aparelho, F3).
    2: (db) => db.delete('sync_metadata', where: 'key = ?', whereArgs: [productsSyncCursorKey]),
  };

  static Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    for (var version = oldVersion + 1; version <= newVersion; version++) {
      final migration = _migrations[version];
      if (migration != null) await migration(db);
    }
  }
```
- em `openAt`, trocar `version: 1, onCreate: _onCreate` por
  `version: currentVersion, onCreate: _onCreate, onUpgrade: _onUpgrade`.

- [ ] **Step 4: Rodar, checar e commit**

```bash
$F test test/core/app_database_migration_test.dart
for i in 1 2 3; do $F test 2>&1 | tail -1; done
$F analyze 2>&1 | tail -1
cd /c/PROJETOS/SAAS && git add mobile_app/lib/core/storage/app_database.dart mobile_app/test/support/v1_schema.dart mobile_app/test/core/app_database_migration_test.dart
git commit -m "feat(mobile): SQLite versão 2 com migrações aditivas (v2 força re-sync total, perdas intactas)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS (2); 3 × `+29: All tests passed!`; `No issues found!`.

---

### Task 3: `ApiClient.getWithHeaders`

**Files:**
- Modify: `mobile_app/lib/core/network/api_client.dart`
- Create: `mobile_app/test/core/api_client_headers_test.dart`

**Interfaces:**
- Produces: `class ApiResponse { final dynamic body; final Map<String, String> headers; }` (nomes de
  cabeçalho em minúsculas, como o `package:http` entrega); `ApiClient.getWithHeaders(String path):
  Future<ApiResponse>` — mesmas exceções do `get` (401/402/rede/erro).

- [ ] **Step 1: Teste (vai falhar)**

Create `mobile_app/test/core/api_client_headers_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inventory_loss_app/core/network/api_client.dart';
import 'package:inventory_loss_app/core/storage/secure_session_storage.dart';
import 'package:inventory_loss_app/data/models/auth_session.dart';

class _NoSessionStorage extends SecureSessionStorage {
  @override
  Future<AuthSession?> read() async => null;
}

void main() {
  test('getWithHeaders devolve o corpo decodificado e os cabeçalhos (em minúsculas)', () async {
    final client = ApiClient(
      sessionStorage: _NoSessionStorage(),
      httpClient: MockClient((request) async => http.Response(
            '[{"id":"p-1"}]',
            200,
            headers: {'content-type': 'application/json', 'X-Sync-Cursor': '2026-09-24T12:00:00.000000Z'},
          )),
    );

    final response = await client.getWithHeaders('/products?limit=5000');

    expect(response.body, [
      {'id': 'p-1'},
    ]);
    expect(response.headers['x-sync-cursor'], '2026-09-24T12:00:00.000000Z');
  });

  test('getWithHeaders mantém as exceções do get (401 ⇒ sessão expirada)', () async {
    final client = ApiClient(
      sessionStorage: _NoSessionStorage(),
      httpClient: MockClient((request) async => http.Response('{"message":"x"}', 401)),
    );

    expect(() => client.getWithHeaders('/products'), throwsA(isA<SessionExpiredException>()));
  });
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `$F test test/core/api_client_headers_test.dart`
Expected: FAIL na compilação — `The method 'getWithHeaders' isn't defined`.

- [ ] **Step 3: Implementar**

Modify `mobile_app/lib/core/network/api_client.dart`:
- antes de `class ApiClient`:
```dart
/// Resposta com os cabeçalhos — o sync de produtos lê X-Sync-Cursor / X-Next-After (SP1, 6.1/6.2).
class ApiResponse {
  final dynamic body;
  final Map<String, String> headers;

  const ApiResponse(this.body, this.headers);
}
```
- depois do método `get`:
```dart
  /// Como [get], mas devolve também os cabeçalhos da resposta.
  Future<ApiResponse> getWithHeaders(String path) async {
    return _sendRaw(() async => _httpClient.get(_uri(path), headers: await _headers()));
  }
```
- renomear o corpo de `_send` para `_sendRaw`, retornando `ApiResponse(decoded, response.headers)` no ramo
  de sucesso (`return decoded;` vira `return ApiResponse(decoded, response.headers);`) e com tipo
  `Future<ApiResponse> _sendRaw(Future<http.Response> Function() request, {bool withAuth = true})`; e
  recriar `_send` como:
```dart
  Future<dynamic> _send(Future<http.Response> Function() request, {bool withAuth = true}) async {
    return (await _sendRaw(request, withAuth: withAuth)).body;
  }
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
$F test test/core/api_client_headers_test.dart
for i in 1 2 3; do $F test 2>&1 | tail -1; done
$F analyze 2>&1 | tail -1
cd /c/PROJETOS/SAAS && git add mobile_app/lib/core/network/api_client.dart mobile_app/test/core/api_client_headers_test.dart
git commit -m "feat(mobile): ApiClient.getWithHeaders (corpo + cabeçalhos)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS (2); 3 × `+31: All tests passed!`; `No issues found!`.

---

### Task 4: `ProductRepository.refreshFromServer` — páginas, tombstones e cursor

**Files:**
- Modify: `mobile_app/lib/data/models/product.dart`
- Modify: `mobile_app/lib/data/repositories/product_repository.dart`
- Create: `mobile_app/test/data/repositories/product_repository_sync_test.dart`

**Interfaces:**
- Consumes: `ApiClient.getWithHeaders`/`ApiResponse` (Task 3); `AppDatabase.productsSyncCursorKey` (Task 2);
  `useIsolatedTestDatabase` (Task 1).
- Produces: `Product.isActive` (padrão `true`); `ProductRepository({ApiClient? apiClient, DateTime
  Function()? now})`; `refreshFromServer()` com o novo comportamento (mesma assinatura — telas não mudam).

- [ ] **Step 1: Testes (vão falhar)**

Create `mobile_app/test/data/repositories/product_repository_sync_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/core/network/api_client.dart';
import 'package:inventory_loss_app/core/storage/app_database.dart';
import 'package:inventory_loss_app/data/repositories/product_repository.dart';

import '../../support/isolated_database.dart';

/// Responde cada chamada com a próxima resposta programada (ou lança a exceção programada) e anota os
/// caminhos pedidos.
class _FakeApiClient extends ApiClient {
  final List<Object> queue;
  final List<String> paths = [];

  _FakeApiClient(this.queue);

  @override
  Future<ApiResponse> getWithHeaders(String path) async {
    paths.add(path);
    final next = queue.removeAt(0);
    if (next is Exception) throw next;
    return next as ApiResponse;
  }
}

Map<String, dynamic> _product(String id, String barcode, {bool isActive = true}) => {
      'id': id,
      'barcode': barcode,
      'sku': null,
      'name': 'Produto $id',
      'unitPrice': '10.00',
      'isActive': isActive,
    };

Future<List<String>> _localIds() async {
  final db = await AppDatabase.instance.database;
  return (await db.query('products', orderBy: 'id')).map((row) => row['id'] as String).toList();
}

Future<String?> _cursor() => AppDatabase.instance.getMetadata(AppDatabase.productsSyncCursorKey);

Future<void> _seedLocal(List<Map<String, dynamic>> products) async {
  final db = await AppDatabase.instance.database;
  for (final p in products) {
    await db.insert('products', {'id': p['id'], 'barcode': p['barcode'], 'name': p['name'], 'unitPrice': 10.0});
  }
}

void main() {
  setUpAll(useIsolatedTestDatabase);
  setUp(() => AppDatabase.instance.clearAll());

  final fixedNow = DateTime.utc(2026, 9, 24, 15, 0);
  const after1 = '2026-09-24T12:00:00.000001Z|5f0c8a1e-3b7d-4c2a-9e61-0d2f4b8a7c11';

  test('primeira carga em várias páginas troca o catálogo inteiro e grava o cursor da 1ª página', () async {
    await _seedLocal([_product('velho', '999')]);
    final api = _FakeApiClient([
      ApiResponse([_product('a', '1'), _product('b', '2')], {
        'x-sync-cursor': '2026-09-24T12:00:00.000000Z',
        'x-next-after': after1,
      }),
      ApiResponse([_product('c', '3')], {'x-sync-cursor': '2026-09-24T12:00:05.000000Z'}),
    ]);

    await ProductRepository(apiClient: api, now: () => fixedNow).refreshFromServer();

    expect(await _localIds(), ['a', 'b', 'c']);
    expect(await _cursor(), '2026-09-24T12:00:00.000000Z');
    expect(api.paths, [
      '/products?limit=5000',
      '/products?limit=5000&after=${Uri.encodeQueryComponent(after1)}',
    ]);
  });

  test('falha na 2ª página da primeira carga: catálogo antigo intacto e nenhum cursor gravado', () async {
    await _seedLocal([_product('velho', '999')]);
    final api = _FakeApiClient([
      ApiResponse([_product('a', '1')], {'x-sync-cursor': '2026-09-24T12:00:00.000000Z', 'x-next-after': after1}),
      NetworkUnavailableException(),
    ]);

    await expectLater(
      ProductRepository(apiClient: api, now: () => fixedNow).refreshFromServer(),
      throwsA(isA<NetworkUnavailableException>()),
    );

    expect(await _localIds(), ['velho']);
    expect(await _cursor(), isNull);
  });

  test('incremental: since = cursor − 2 min, pede tombstones, aplica upsert e DELETE do arquivado', () async {
    await _seedLocal([_product('fica', '1'), _product('arquivado', '2')]);
    await AppDatabase.instance.setMetadata(AppDatabase.productsSyncCursorKey, '2026-09-24T12:00:00.000000Z');
    final api = _FakeApiClient([
      ApiResponse(
        [_product('arquivado', '2', isActive: false), _product('novo', '3')],
        {'x-sync-cursor': '2026-09-24T13:00:00.000000Z'},
      ),
    ]);

    await ProductRepository(apiClient: api, now: () => fixedNow).refreshFromServer();

    expect(api.paths.single,
        '/products?since=${Uri.encodeQueryComponent('2026-09-24T11:58:00.000Z')}&includeArchived=true&limit=5000');
    expect(await _localIds(), ['fica', 'novo']);
    expect(await _cursor(), '2026-09-24T13:00:00.000000Z');
  });

  test('tombstone e produto novo com o MESMO código de barras na mesma sincronização', () async {
    await _seedLocal([_product('antigo', '777')]);
    await AppDatabase.instance.setMetadata(AppDatabase.productsSyncCursorKey, '2026-09-24T12:00:00.000000Z');
    final api = _FakeApiClient([
      ApiResponse(
        [_product('substituto', '777'), _product('antigo', '777', isActive: false)],
        {'x-sync-cursor': '2026-09-24T13:00:00.000000Z'},
      ),
    ]);

    await ProductRepository(apiClient: api, now: () => fixedNow).refreshFromServer();

    expect(await _localIds(), ['substituto']);
  });

  test('servidor antigo (sem cabeçalhos): uma página só e o cursor é o relógio do aparelho', () async {
    final api = _FakeApiClient([
      ApiResponse([_product('a', '1')], {}),
    ]);

    await ProductRepository(apiClient: api, now: () => fixedNow).refreshFromServer();

    expect(api.paths, ['/products?limit=5000']);
    expect(await _localIds(), ['a']);
    expect(await _cursor(), fixedNow.toIso8601String());
  });

  test('servidor com bug repetindo o mesmo X-Next-After: para com erro, sem loop e sem gravar cursor', () async {
    final page = ApiResponse([_product('a', '1')], {'x-sync-cursor': '2026-09-24T12:00:00.000000Z', 'x-next-after': after1});
    final api = _FakeApiClient([page, page, page]);

    await expectLater(
      ProductRepository(apiClient: api, now: () => fixedNow).refreshFromServer(),
      throwsA(isA<StateError>()),
    );

    expect(api.paths, hasLength(2));
    expect(await _cursor(), isNull);
  });
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `$F test test/data/repositories/product_repository_sync_test.dart`
Expected: FAIL na compilação — `No named parameter with the name 'now'` (e `getWithHeaders` não é usado
pelo repositório ainda).

- [ ] **Step 3: Implementar**

Modify `mobile_app/lib/data/models/product.dart`:
- campo `final bool isActive;` depois de `unitPrice`; no construtor `this.isActive = true,`;
- em `fromApiJson`: `isActive: json['isActive'] as bool? ?? true,`
(`fromLocalMap`/`toLocalMap` não mudam: o banco local só guarda ativos.)

Modify `mobile_app/lib/data/repositories/product_repository.dart` — trocar a classe até o fim de
`refreshFromServer` (inclusive) por:
```dart
class ProductRepository {
  static const _pageLimit = 5000;

  /// Sobreposição do sync incremental (spec do SP1, 6.2): updatedAt é o INÍCIO da transação de quem gravou
  /// (F5), então uma linha pode ficar visível depois de um cursor mais novo — pedir 2 min antes cobre isso.
  static const _overlap = Duration(minutes: 2);

  final ApiClient _apiClient;
  final DateTime Function() _now;

  ProductRepository({ApiClient? apiClient, DateTime Function()? now})
      : _apiClient = apiClient ?? ApiClient(),
        _now = now ?? DateTime.now;

  /// Sincroniza o catálogo (SP1, 6.2). Baixa TODAS as páginas para a memória e só então aplica tudo —
  /// catálogo e cursor — numa única transação: uma falha no meio nunca deixa o aparelho sem catálogo nem
  /// com um cursor adiantado. Produto arquivado (tombstone) é apagado do aparelho.
  Future<void> refreshFromServer() async {
    final cursor = await AppDatabase.instance.getMetadata(AppDatabase.productsSyncCursorKey);
    final deviceStartedAt = _now().toUtc();
    final isFirstLoad = cursor == null;
    final baseQuery = isFirstLoad
        ? 'limit=$_pageLimit'
        : 'since=${Uri.encodeQueryComponent(_sinceWithOverlap(cursor))}&includeArchived=true&limit=$_pageLimit';

    final received = <Product>[];
    String? serverCursor;
    String? after;
    var isFirstPage = true;
    do {
      final path = after == null ? '/products?$baseQuery' : '/products?$baseQuery&after=${Uri.encodeQueryComponent(after)}';
      final response = await _apiClient.getWithHeaders(path);
      if (isFirstPage) {
        // O cursor da 1ª página é o mais antigo da carga — o mais conservador (revisão da 1.4.1).
        serverCursor = response.headers['x-sync-cursor'];
        isFirstPage = false;
      }
      received.addAll((response.body as List).map((e) => Product.fromApiJson(e as Map<String, dynamic>)));
      final nextAfter = response.headers['x-next-after'];
      if (nextAfter != null && nextAfter == after) {
        throw StateError('O servidor repetiu o cursor de paginação ($nextAfter); sincronização interrompida.');
      }
      after = nextAfter;
    } while (after != null);

    final db = await AppDatabase.instance.database;
    await db.transaction((txn) async {
      if (isFirstLoad) {
        await txn.delete('products');
      } else {
        // DELETE antes dos upserts: um produto novo pode reutilizar o código de barras de um arquivado
        // (índice único local em barcode).
        for (final product in received.where((p) => !p.isActive)) {
          await txn.delete('products', where: 'id = ?', whereArgs: [product.id]);
        }
      }
      for (final product in received.where((p) => p.isActive)) {
        await txn.insert('products', product.toLocalMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await txn.insert(
        'sync_metadata',
        {'key': AppDatabase.productsSyncCursorKey, 'value': serverCursor ?? deviceStartedAt.toIso8601String()},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    });
  }

  String _sinceWithOverlap(String cursor) {
    final parsed = DateTime.tryParse(cursor);
    if (parsed == null) return cursor;
    return parsed.toUtc().subtract(_overlap).toIso8601String();
  }
```
(remover a constante antiga `static const _lastSyncKey = 'products_last_sync_at';`; manter
`findAllLocal` e `findByBarcodeLocal` como estão; atualizar o comentário da classe para citar o SP1 6.2.)

- [ ] **Step 4: Rodar, checar e commit**

```bash
$F test test/data/repositories/product_repository_sync_test.dart
for i in 1 2 3; do $F test 2>&1 | tail -1; done
$F analyze 2>&1 | tail -1
cd /c/PROJETOS/SAAS && git add mobile_app/lib/data/models/product.dart mobile_app/lib/data/repositories/product_repository.dart mobile_app/test/data/repositories/product_repository_sync_test.dart
git commit -m "feat(mobile): sync de produtos por páginas com troca atômica, tombstones e cursor do servidor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS (6); 3 × `+37: All tests passed!`; `No issues found!`.

---

### Task 5: Verificação no emulador e registro do andamento

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` (seção 6)
- Modify: `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10)

- [ ] **Step 1: Ambiente**

Backend rodando (`preview_start` "backend", porta 3000 — o banco de desenvolvimento já tem a 14000).
Emulador: `C:/flutter/bin/flutter emulators --launch flutter_emulator` (esperar ~30 s; `flutter devices` até
aparecer `emulator-5554`). O app instalado no emulador é a versão antiga (banco v1, com uma perda pendente
de testes anteriores). Anotar antes: `adb` em `C:\android-sdk\platform-tools\adb.exe`; capturas com
`adb exec-out screencap -p > arquivo.png` (salvar no scratchpad da sessão).

- [ ] **Step 2: Atualização v1 → v2 num aparelho "de verdade"**

`C:/flutter/bin/flutter run -d emulator-5554 --no-hot` (instala a versão nova por cima, sem apagar dados).
Conferir: o app abre logado; a perda pendente antiga continua na fila (tela de pendências / início); tocar
em "Atualizar catálogo" funciona e o produto arquivado "sprite" (arquivado no painel) **não** está no
aparelho — entrada manual do código `123456789` na tela de escanear diz que não encontrou.

- [ ] **Step 3: Arquivar no painel some do celular**

Pelo painel (ou `PATCH`/`DELETE` via navegador do painel logado como gerente), arquivar um produto de teste
que esteja no aparelho (ex.: "fanta", código `1234`); no app, "Atualizar catálogo"; a entrada manual do
código `1234` passa a dizer que não encontrou. **Depois reativar o produto no painel** e atualizar de novo no
app — ele volta. Os dados terminam como estavam. Capturas de tela como prova.

- [ ] **Step 4: Registrar e commit**

Modify `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` — logo depois do parágrafo
"**Divisão da etapa (2026-09-24):** …" da seção 6:
```markdown
**Resultado da 1.4.2 (<data>):** `ApiClient.getWithHeaders`; `ProductRepository.refreshFromServer` baixa todas
as páginas (`limit=5000`, segue `X-Next-After`, para se o servidor repetir o cursor) e aplica catálogo +
cursor numa transação; incremental com `since = cursor − 2 min` e tombstones (DELETE antes dos upserts);
cursor = `X-Sync-Cursor` da 1ª página (servidor antigo: relógio do aparelho). `AppDatabase` v2 com
`openAt` e `_migrations` aditivas (v2 apaga o cursor ⇒ re-sync total). Suíte do app deixou de ser
intermitente (banco em memória por arquivo de teste). Verificado no emulador: atualização v1→v2 com perda
pendente intacta; arquivar no painel remove o produto do celular no próximo sync. **Etapa 1.4 e SP1
concluídos.**
```
Na seção 10 do mestre: linha do SP1 — status "**SP1 concluído**" com a data, link do plano 1.4.2, baseline
do app; próximo: SP2 (conforme a ordem do mestre).

```bash
cd /c/PROJETOS/SAAS && git add docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "docs: andamento do SP1 — sub-etapa 1.4.2, etapa 1.4 e SP1 concluídos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (6.2 e testes do app de 6.3):** corpo + cabeçalhos → Task 3; primeira carga em memória
e troca atômica → Task 4; incremental com `since − 2 min`, `includeArchived`, `limit=5000`, `X-Next-After`,
tombstone ⇒ DELETE → Task 4; cursor só no fim → Task 4 (transação única; teste de falha); servidor antigo →
Task 4; `version: 2`, `onUpgrade` com `_migrations`, v2 apaga o cursor, sem downgrade destrutivo, `openAt` →
Tasks 1 e 2. Testes 6.3: migração v1→v2 com perda pendente (Task 2); repositório com `ApiClient` falso —
várias páginas com troca atômica, falha na 2ª página, tombstone, cursor no fim, servidor antigo (Task 4).

**Review Focus:** 1, 3, 4, 5 → Task 4; 2 → Task 2.

**Decisões deste plano:** cursor = o da 1ª página; primeira carga sem `includeArchived`; Task 1 (banco isolado
por arquivo de teste) acrescentada porque a suíte atual é intermitente e os testes novos agravariam; guarda
contra cursor repetido (`StateError`).

**Placeholders:** `<data>` na Task 5 é preenchido na execução.

**Consistência:** `openAt`/`useDatabaseAtForTesting` (Task 1), `currentVersion`/`productsSyncCursorKey`
(Task 2), `ApiResponse`/`getWithHeaders` (Task 3), `ProductRepository({apiClient, now})`/`Product.isActive`
(Task 4) — mesmos nomes onde reaparecem.

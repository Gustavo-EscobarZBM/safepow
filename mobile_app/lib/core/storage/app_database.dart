import 'package:flutter/foundation.dart';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

/// Banco local do app (Seção 4.1 do documento): guarda o catálogo de produtos
/// baixado do servidor (para funcionar offline) e a fila de perdas pendentes
/// de sincronização. Usa SQLite puro via sqflite — sem geração de código —
/// para manter o projeto simples de compilar e auditar.
class AppDatabase {
  AppDatabase._internal();
  static final AppDatabase instance = AppDatabase._internal();

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

  Database? _db;
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

  Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDb();
    return _db!;
  }

  Future<Database> _initDb() async {
    final path = _pathOverride ?? join(await getDatabasesPath(), 'inventory_loss_app.db');
    return openAt(path);
  }

  /// Abre (criando ou migrando) o banco do app num caminho qualquer — ponto único de abertura, usado pelo
  /// app e pelos testes de migração.
  static Future<Database> openAt(String path) {
    return openDatabase(path, version: currentVersion, onCreate: _onCreate, onUpgrade: _onUpgrade);
  }

  static Future<void> _onCreate(Database db, int version) async {
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

    // Catálogos cadastrados pelo gerente (Cadastros > Motivo/Local da
    // Perda) — baixados por inteiro após o login, igual ao catálogo de
    // produtos, para o formulário de registro funcionar offline.
    await db.execute('''
      CREATE TABLE loss_reasons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    ''');
    await db.execute('''
      CREATE TABLE loss_locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    ''');

    // Metadados simples de sincronização (ex: data/hora da última vez que
    // o catálogo de produtos foi baixado) — usado pela sincronização
    // incremental (Seção 4.3 do documento).
    await db.execute('''
      CREATE TABLE sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    ''');
  }

  Future<void> clearAll() async {
    final db = await database;
    await db.delete('products');
    await db.delete('losses');
    await db.delete('loss_reasons');
    await db.delete('loss_locations');
    await db.delete('sync_metadata');
  }

  Future<String?> getMetadata(String key) async {
    final db = await database;
    final rows = await db.query('sync_metadata', where: 'key = ?', whereArgs: [key], limit: 1);
    if (rows.isEmpty) return null;
    return rows.first['value'] as String;
  }

  Future<void> setMetadata(String key, String value) async {
    final db = await database;
    await db.insert(
      'sync_metadata',
      {'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }
}

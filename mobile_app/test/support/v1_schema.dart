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

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
    final losses = await v2.query('losses');
    expect(losses, hasLength(1));
    expect(losses.first['clientGeneratedId'], 'loss-pendente');
    expect(losses.first['syncStatus'], 'pending');
    final metadata = await v2.query('sync_metadata');
    expect(metadata.map((row) => row['key']), isNot(contains('products_last_sync_at')));
    expect(metadata.map((row) => row['key']), contains('cached_company_id'));
    await v2.close();
  });

  test('v2 → v3 (SP4 4.1): produtos ganham unidade/foto/perecível e o cursor é apagado', () async {
    final path = '${dir.path}/v2.db';
    final v2 = await databaseFactoryFfi.openDatabase(
      path,
      options: OpenDatabaseOptions(version: 2, onCreate: (db, _) => createV1Schema(db)),
    );
    await v2.insert('products', {'id': 'p-1', 'barcode': '111', 'name': 'Arroz', 'unitPrice': 10.0});
    await v2.insert('sync_metadata', {'key': 'products_last_sync_at', 'value': '2026-09-28T10:00:00.000Z'});
    await v2.close();

    final v3 = await AppDatabase.openAt(path);
    expect(await v3.getVersion(), 3);
    final products = await v3.query('products');
    expect(products.single['name'], 'Arroz');
    expect(products.single['unit'], 'UN');
    expect(products.single['isPerishable'], 0);
    expect(products.single['imageUrl'], isNull);
    expect((await v3.query('sync_metadata')).map((row) => row['key']), isNot(contains('products_last_sync_at')));
    await v3.close();
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

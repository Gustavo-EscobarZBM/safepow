import 'package:sqflite/sqflite.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/app_database.dart';
import '../models/product.dart';

/// Implementa a sincronização de catálogo descrita na Seção 4.3 do documento:
/// o app mantém uma cópia local dos produtos para que o funcionário consiga
/// buscar/escanear mesmo sem internet. A partir da segunda sincronização, só
/// baixa o que mudou desde a última vez (?since=), em vez do catálogo inteiro
/// — importante para empresas com catálogos grandes.
class ProductRepository {
  static const _lastSyncKey = 'products_last_sync_at';

  final ApiClient _apiClient;

  ProductRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  Future<void> refreshFromServer() async {
    final lastSync = await AppDatabase.instance.getMetadata(_lastSyncKey);
    final syncStartedAt = DateTime.now().toUtc();

    final path = lastSync != null ? '/products?since=$lastSync' : '/products';
    final json = await _apiClient.get(path);
    final products = (json as List).map((e) => Product.fromApiJson(e as Map<String, dynamic>)).toList();

    final db = await AppDatabase.instance.database;
    if (lastSync == null) {
      // Primeira sincronização: substitui o catálogo inteiro.
      final batch = db.batch();
      batch.delete('products');
      for (final product in products) {
        batch.insert('products', product.toLocalMap());
      }
      await batch.commit(noResult: true);
    } else {
      // Sincronizações seguintes: upsert só do que veio (mudou desde a última vez).
      final batch = db.batch();
      for (final product in products) {
        batch.insert(
          'products',
          product.toLocalMap(),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
      await batch.commit(noResult: true);
    }

    await AppDatabase.instance.setMetadata(_lastSyncKey, syncStartedAt.toIso8601String());
  }

  Future<List<Product>> findAllLocal() async {
    final db = await AppDatabase.instance.database;
    final rows = await db.query('products', orderBy: 'name ASC');
    return rows.map(Product.fromLocalMap).toList();
  }

  /// Busca primeiro no cache local (funciona offline); é a forma usada pela
  /// tela de escaneamento, já que o funcionário pode estar sem sinal no
  /// depósito (Seção 4 do documento).
  Future<Product?> findByBarcodeLocal(String barcode) async {
    final db = await AppDatabase.instance.database;
    final rows = await db.query('products', where: 'barcode = ?', whereArgs: [barcode], limit: 1);
    if (rows.isEmpty) return null;
    return Product.fromLocalMap(rows.first);
  }
}

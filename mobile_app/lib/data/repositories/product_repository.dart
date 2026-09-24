import 'package:sqflite/sqflite.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/app_database.dart';
import '../models/product.dart';

/// Implementa a sincronização de catálogo descrita na Seção 4.3 do documento:
/// o app mantém uma cópia local dos produtos para que o funcionário consiga
/// buscar/escanear mesmo sem internet. A partir da segunda sincronização, só
/// baixa o que mudou desde o cursor do servidor (SP1, 6.2): páginas com
/// X-Next-After, produtos arquivados removidos do aparelho (tombstones).
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
      // Um único batch dentro da transação: no Android cada `await txn.insert` é uma ida e volta pelo canal
      // de plataforma — com um catálogo grande (toda primeira carga, inclusive a forçada pela migração v2)
      // isso travaria o banco por dezenas de segundos.
      final batch = txn.batch();
      if (isFirstLoad) {
        batch.delete('products');
      } else {
        // DELETE antes dos upserts: um produto novo pode reutilizar o código de barras de um arquivado
        // (índice único local em barcode).
        for (final product in received.where((p) => !p.isActive)) {
          batch.delete('products', where: 'id = ?', whereArgs: [product.id]);
        }
      }
      for (final product in received.where((p) => p.isActive)) {
        batch.insert('products', product.toLocalMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      }
      batch.insert(
        'sync_metadata',
        {'key': AppDatabase.productsSyncCursorKey, 'value': serverCursor ?? deviceStartedAt.toIso8601String()},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await batch.commit(noResult: true);
    });
  }

  String _sinceWithOverlap(String cursor) {
    final parsed = DateTime.tryParse(cursor);
    if (parsed == null) return cursor;
    return parsed.toUtc().subtract(_overlap).toIso8601String();
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

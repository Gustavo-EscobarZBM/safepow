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

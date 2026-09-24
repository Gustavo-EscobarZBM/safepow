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

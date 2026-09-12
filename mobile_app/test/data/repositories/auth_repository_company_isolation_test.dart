import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:inventory_loss_app/core/network/api_client.dart';
import 'package:inventory_loss_app/core/storage/app_database.dart';
import 'package:inventory_loss_app/core/storage/secure_session_storage.dart';
import 'package:inventory_loss_app/data/models/auth_session.dart';
import 'package:inventory_loss_app/data/repositories/auth_repository.dart';

/// Guarda a sessão em memória em vez de Keystore/Keychain (indisponível em
/// `flutter test`, que roda em Dart VM puro, sem plugins de plataforma).
class _InMemorySessionStorage extends SecureSessionStorage {
  AuthSession? _stored;

  @override
  Future<void> save(AuthSession session) async {
    _stored = session;
  }

  @override
  Future<AuthSession?> read() async {
    return _stored;
  }

  @override
  Future<void> clear() async {
    _stored = null;
  }
}

/// Substitui a chamada HTTP real de login por uma resposta programada —
/// evita subir um backend de verdade só para testar a lógica de troca de
/// empresa no dispositivo.
class _FakeApiClient extends ApiClient {
  Map<String, dynamic>? nextLoginResponse;

  @override
  Future<dynamic> post(String path, Map<String, dynamic> body, {bool withAuth = true}) async {
    if (path == '/auth/login') return nextLoginResponse;
    throw UnimplementedError('not stubbed: $path');
  }
}

Map<String, dynamic> _loginResponse({required String userId, required String companyId}) => {
      'accessToken': 'token-$userId',
      'user': {'id': userId, 'name': 'Usuário Teste', 'role': 'employee', 'companyId': companyId},
    };

void main() {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  const companyA = '11111111-1111-1111-1111-111111111111';
  const companyB = '22222222-2222-2222-2222-222222222222';

  setUp(() async {
    // Cada teste começa com o banco local zerado, como um dispositivo novo.
    await AppDatabase.instance.clearAll();
  });

  test('troca de empresa no mesmo dispositivo limpa o cache local da empresa anterior', () async {
    final apiClient = _FakeApiClient();
    final authRepository = AuthRepository(apiClient: apiClient, sessionStorage: _InMemorySessionStorage());

    // Funcionário da empresa A loga e o catálogo dela é sincronizado (como
    // ProductRepository.refreshFromServer() faria após o login).
    apiClient.nextLoginResponse = _loginResponse(userId: 'user-a', companyId: companyA);
    await authRepository.login('funcionario@empresaA.com', 'senha123');
    final db = await AppDatabase.instance.database;
    await db.insert('products', {
      'id': 'prod-a-1234',
      'barcode': '1234',
      'sku': null,
      'name': 'Produto da Empresa A',
      'unitPrice': 10.0,
    });

    // Sem logout explícito (ex.: sessão expirou), um funcionário da empresa B
    // loga no mesmo aparelho.
    apiClient.nextLoginResponse = _loginResponse(userId: 'user-b', companyId: companyB);
    await authRepository.login('funcionario@empresaB.com', 'senha123');

    final cachedProducts = await db.query('products');
    expect(
      cachedProducts,
      isEmpty,
      reason: 'produto da empresa A vazou para o cache local da empresa B após a troca de login',
    );
  });

  test('relogar na mesma empresa preserva o cache local (fila de sincronização não é perdida)', () async {
    final apiClient = _FakeApiClient();
    final authRepository = AuthRepository(apiClient: apiClient, sessionStorage: _InMemorySessionStorage());

    apiClient.nextLoginResponse = _loginResponse(userId: 'user-a', companyId: companyA);
    await authRepository.login('funcionario@empresaA.com', 'senha123');
    final db = await AppDatabase.instance.database;
    await db.insert('products', {
      'id': 'prod-a-1234',
      'barcode': '1234',
      'sku': null,
      'name': 'Produto da Empresa A',
      'unitPrice': 10.0,
    });

    // Token expirou; o mesmo funcionário da mesma empresa loga de novo.
    apiClient.nextLoginResponse = _loginResponse(userId: 'user-a', companyId: companyA);
    await authRepository.login('funcionario@empresaA.com', 'senha123');

    final cachedProducts = await db.query('products');
    expect(cachedProducts, hasLength(1), reason: 'relogin na mesma empresa não deveria limpar o cache local');
  });
}

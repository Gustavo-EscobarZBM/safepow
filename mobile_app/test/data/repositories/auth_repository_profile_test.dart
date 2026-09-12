import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:inventory_loss_app/core/network/api_client.dart';
import 'package:inventory_loss_app/core/storage/app_database.dart';
import 'package:inventory_loss_app/data/repositories/auth_repository.dart';

class _FakeApiClient extends ApiClient {
  Map<String, dynamic>? nextGetResponse;
  String? lastPatchedPath;
  Map<String, dynamic>? lastPatchedBody;

  @override
  Future<dynamic> get(String path) async {
    if (path == '/users/me') return nextGetResponse;
    throw UnimplementedError('not stubbed: $path');
  }

  @override
  Future<dynamic> patch(String path, Map<String, dynamic> body) async {
    lastPatchedPath = path;
    lastPatchedBody = body;
    return {'ok': true};
  }
}

void main() {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  setUp(() async {
    await AppDatabase.instance.clearAll();
  });

  test('getMe() busca o perfil em GET /users/me e devolve nome, e-mail, papel e empresa', () async {
    final apiClient = _FakeApiClient()
      ..nextGetResponse = {
        'name': 'Maria Gerente',
        'email': 'maria@empresa.com',
        'role': 'manager',
        'companyName': 'Empresa Demo',
      };
    final authRepository = AuthRepository(apiClient: apiClient);

    final profile = await authRepository.getMe();

    expect(profile.name, 'Maria Gerente');
    expect(profile.email, 'maria@empresa.com');
    expect(profile.companyName, 'Empresa Demo');
  });

  test('changePassword() envia currentPassword e newPassword para PATCH /users/me', () async {
    final apiClient = _FakeApiClient();
    final authRepository = AuthRepository(apiClient: apiClient);

    await authRepository.changePassword(currentPassword: 'senhaAntiga', newPassword: 'senhaNova123');

    expect(apiClient.lastPatchedPath, '/users/me');
    expect(apiClient.lastPatchedBody, {
      'currentPassword': 'senhaAntiga',
      'newPassword': 'senhaNova123',
    });
  });
}

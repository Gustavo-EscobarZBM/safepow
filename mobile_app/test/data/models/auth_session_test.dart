import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/data/models/auth_session.dart';

void main() {
  test('fromApiJson lê lossVerificationEnabled e isLossVerifier do payload de login', () {
    final session = AuthSession.fromApiJson({
      'accessToken': 'token-123',
      'user': {'id': 'user-1', 'name': 'Fulano', 'role': 'employee', 'companyId': 'company-1'},
      'lossVerificationEnabled': true,
      'isLossVerifier': true,
    });

    expect(session.lossVerificationEnabled, true);
    expect(session.isLossVerifier, true);
  });

  test('fromApiJson usa false como padrão quando os campos não vêm no payload', () {
    final session = AuthSession.fromApiJson({
      'accessToken': 'token-123',
      'user': {'id': 'user-1', 'name': 'Fulano', 'role': 'employee', 'companyId': 'company-1'},
    });

    expect(session.lossVerificationEnabled, false);
    expect(session.isLossVerifier, false);
  });

  test('toStorageJson/fromStorageJson preservam os dois campos num round-trip', () {
    final original = AuthSession(
      accessToken: 'token-123',
      userId: 'user-1',
      userName: 'Fulano',
      role: 'manager',
      companyId: 'company-1',
      lossVerificationEnabled: true,
      isLossVerifier: false,
    );

    final restored = AuthSession.fromStorageJson(original.toStorageJson());

    expect(restored.lossVerificationEnabled, true);
    expect(restored.isLossVerifier, false);
  });

  test('fromStorageJson usa false como padrão para sessões salvas antes desta mudança', () {
    final restored = AuthSession.fromStorageJson({
      'accessToken': 'token-123',
      'userId': 'user-1',
      'userName': 'Fulano',
      'role': 'employee',
      'companyId': 'company-1',
    });

    expect(restored.lossVerificationEnabled, false);
    expect(restored.isLossVerifier, false);
  });
}

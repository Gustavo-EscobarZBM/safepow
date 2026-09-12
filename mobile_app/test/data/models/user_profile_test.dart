import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/data/models/user_profile.dart';

void main() {
  test('UserProfile.fromApiJson lê nome, e-mail, papel e nome da empresa', () {
    final profile = UserProfile.fromApiJson({
      'name': 'Maria Gerente',
      'email': 'maria@empresa.com',
      'role': 'manager',
      'companyName': 'Empresa Demo',
    });

    expect(profile.name, 'Maria Gerente');
    expect(profile.email, 'maria@empresa.com');
    expect(profile.role, 'manager');
    expect(profile.companyName, 'Empresa Demo');
  });

  test('UserProfile.fromApiJson aceita companyName nulo (master_admin sem empresa)', () {
    final profile = UserProfile.fromApiJson({
      'name': 'Admin Master',
      'email': 'master@seusistema.com.br',
      'role': 'master_admin',
      'companyName': null,
    });

    expect(profile.companyName, isNull);
  });
}

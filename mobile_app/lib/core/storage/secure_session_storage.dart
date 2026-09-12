import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../data/models/auth_session.dart';

/// Guarda o token JWT e os dados básicos da sessão em armazenamento seguro
/// (Keystore no Android / Keychain no iOS) — nunca em SharedPreferences puro,
/// que não é criptografado.
class SecureSessionStorage {
  static const _key = 'auth_session';
  final _storage = const FlutterSecureStorage();

  Future<void> save(AuthSession session) async {
    await _storage.write(key: _key, value: jsonEncode(session.toStorageJson()));
  }

  Future<AuthSession?> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return null;
    return AuthSession.fromStorageJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  Future<void> clear() async {
    await _storage.delete(key: _key);
  }
}

import '../../core/network/api_client.dart';
import '../../core/storage/app_database.dart';
import '../../core/storage/secure_session_storage.dart';
import '../models/auth_session.dart';
import '../models/user_profile.dart';

class AuthRepository {
  static const _cachedCompanyIdKey = 'cached_company_id';

  final ApiClient _apiClient;
  final SecureSessionStorage _sessionStorage;

  AuthRepository({ApiClient? apiClient, SecureSessionStorage? sessionStorage})
      : _apiClient = apiClient ?? ApiClient(),
        _sessionStorage = sessionStorage ?? SecureSessionStorage();

  Future<AuthSession> login(String email, String password) async {
    final json = await _apiClient.post(
      '/auth/login',
      {'email': email, 'password': password},
      withAuth: false,
    );
    final session = AuthSession.fromApiJson(json as Map<String, dynamic>);
    await _ensureLocalCacheMatchesCompany(session.companyId);
    await _sessionStorage.save(session);
    return session;
  }

  /// O cache local (catálogo de produtos, motivos, locais e a fila de perdas
  /// pendentes de sincronização) não é separado por empresa — nenhuma tabela
  /// do AppDatabase tem coluna companyId. Se o dispositivo estava logado numa
  /// empresa diferente, os dados dela vazariam para a sessão nova (ex.: dois
  /// produtos com o mesmo código de barras em empresas distintas, ou uma
  /// perda lançada numa empresa aparecendo na outra). Perdas ainda não
  /// sincronizadas da empresa anterior também são descartadas aqui: seus IDs
  /// de produto/local/motivo só existem no catálogo antigo, sem forma de
  /// reconciliá-los com o da empresa nova.
  Future<void> _ensureLocalCacheMatchesCompany(String? companyId) async {
    final cached = await AppDatabase.instance.getMetadata(_cachedCompanyIdKey);
    if (cached != (companyId ?? '')) {
      await AppDatabase.instance.clearAll();
      await AppDatabase.instance.setMetadata(_cachedCompanyIdKey, companyId ?? '');
    }
  }

  Future<AuthSession?> currentSession() => _sessionStorage.read();

  Future<void> logout() => _sessionStorage.clear();

  /// Tela de Perfil — busca sempre ao vivo (não cacheado localmente).
  Future<UserProfile> getMe() async {
    final json = await _apiClient.get('/users/me');
    return UserProfile.fromApiJson(json as Map<String, dynamic>);
  }

  Future<void> changePassword({required String currentPassword, required String newPassword}) {
    return _apiClient.patch('/users/me', {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
  }
}

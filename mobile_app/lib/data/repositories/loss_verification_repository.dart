import '../../core/network/api_client.dart';
import '../models/pending_verification_loss.dart';

/// Conferência de descarte (spec seção 5) — sempre busca ao vivo do servidor,
/// nunca cacheado localmente (a lista depende de registros de outros
/// funcionários, não faz sentido guardar offline).
class LossVerificationRepository {
  final ApiClient _apiClient;

  LossVerificationRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  Future<List<PendingVerificationLoss>> fetchPending() async {
    final json = await _apiClient.get('/losses/pending-verification');
    return (json as List)
        .map((e) => PendingVerificationLoss.fromApiJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> confirm(String lossId) {
    return _apiClient.patch('/losses/$lossId/verify', {});
  }
}

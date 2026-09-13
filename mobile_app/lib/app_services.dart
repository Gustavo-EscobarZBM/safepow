import 'core/network/api_client.dart';
import 'core/sync/sync_queue_service.dart';
import 'data/repositories/auth_repository.dart';
import 'data/repositories/loss_location_repository.dart';
import 'data/repositories/loss_reason_repository.dart';
import 'data/repositories/loss_repository.dart';
import 'data/repositories/loss_verification_repository.dart';
import 'data/repositories/product_repository.dart';

/// Instâncias únicas usadas pelas telas. Um projeto maior tende a evoluir
/// para Riverpod/Bloc, mas para o MVP deste app um localizador simples como
/// este é suficiente e não adiciona dependências extras para compilar.
class AppServices {
  AppServices._();
  static final ApiClient apiClient = ApiClient();
  static final AuthRepository authRepository = AuthRepository(apiClient: apiClient);
  static final ProductRepository productRepository = ProductRepository(apiClient: apiClient);
  static final LossReasonRepository lossReasonRepository = LossReasonRepository(apiClient: apiClient);
  static final LossLocationRepository lossLocationRepository =
      LossLocationRepository(apiClient: apiClient);
  static final LossRepository lossRepository = LossRepository();
  static final LossVerificationRepository lossVerificationRepository =
      LossVerificationRepository(apiClient: apiClient);
  static final SyncQueueService syncQueueService = SyncQueueService(
    lossRepository: lossRepository,
    apiClient: apiClient,
  );
}

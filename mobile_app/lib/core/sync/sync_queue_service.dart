import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import '../../data/models/loss.dart';
import '../../data/repositories/loss_repository.dart';
import '../config/app_config.dart';
import '../network/api_client.dart';

/// Motor da sincronização offline-first descrita na Seção 4 do documento de
/// arquitetura.
///
/// Estratégia de retry: backoff progressivo simples baseado no número de
/// tentativas (30s, 1min, 5min, 15min, depois 30min fixo) — evita bater no
/// servidor ou gastar bateria/dados quando a conexão está instável, conforme
/// a Seção 4.2 recomenda.
///
/// LIMITAÇÃO IMPORTANTE (documentada aqui de propósito): este serviço só roda
/// enquanto o app está aberto (dispara por conectividade + um timer em
/// primeiro plano). Sincronização de verdade em segundo plano — com o app
/// fechado — exige registrar tarefas nativas:
///   - Android: pacote `workmanager` (usa o WorkManager do sistema).
///   - iOS: `BGTaskScheduler`, com entitlement configurado no Xcode.
/// Ambos exigem configuração nativa específica de cada plataforma que não é
/// possível validar sem compilar em um Mac/Android real — por isso foram
/// deixados como o próximo passo de infraestrutura mobile (ver README).
class SyncQueueService extends ChangeNotifier {
  final LossRepository _lossRepository;
  final ApiClient _apiClient;

  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  Timer? _foregroundTimer;
  bool _isSyncing = false;
  bool subscriptionBlocked = false;
  bool sessionExpired = false;

  int pendingCount = 0;
  int errorCount = 0;

  SyncQueueService({LossRepository? lossRepository, ApiClient? apiClient})
      : _lossRepository = lossRepository ?? LossRepository(),
        _apiClient = apiClient ?? ApiClient();

  void start() {
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen((results) {
      final hasConnection = results.any((r) => r != ConnectivityResult.none);
      if (hasConnection) trySyncPending();
    });

    _foregroundTimer = Timer.periodic(AppConfig.foregroundSyncInterval, (_) => trySyncPending());

    // Primeira tentativa assim que o serviço inicia (ex: app acabou de abrir).
    trySyncPending();
    refreshCounts();
  }

  @override
  void dispose() {
    _connectivitySubscription?.cancel();
    _foregroundTimer?.cancel();
    super.dispose();
  }

  Future<void> refreshCounts() async {
    final pending = await _lossRepository.findPending();
    pendingCount = pending.where((l) => l.syncStatus == LossSyncStatus.pending).length;
    errorCount = pending.where((l) => l.syncStatus == LossSyncStatus.error).length;
    notifyListeners();
  }

  /// Percorre a fila local e tenta enviar cada item pendente. Chamado
  /// automaticamente (conectividade/timer) e também manualmente (ex: usuário
  /// puxa para atualizar a lista de pendências).
  Future<void> trySyncPending() async {
    if (_isSyncing || subscriptionBlocked || sessionExpired) return;
    _isSyncing = true;

    try {
      final pending = await _lossRepository.findPending();

      for (final loss in pending) {
        if (!_isReadyForRetry(loss)) continue;

        try {
          var currentLoss = loss;

          // Se há uma foto local ainda não enviada, sobe ela primeiro (Seção
          // 2.3 do documento — object storage). Se isso falhar, o registro
          // inteiro fica pendente e tenta de novo no próximo ciclo — evita
          // perder o vínculo entre a perda e sua foto.
          if (currentLoss.localImagePath != null && currentLoss.uploadedImageUrl == null) {
            final uploadResult = await _apiClient.postMultipartFile(
              '/uploads/loss-image',
              currentLoss.localImagePath!,
            );
            final url = (uploadResult as Map)['url'] as String;
            await _lossRepository.updateUploadedImageUrl(currentLoss.clientGeneratedId, url);
            currentLoss = currentLoss.copyWith(uploadedImageUrl: url);
          }

          await _apiClient.post('/losses', currentLoss.toApiJson());
          // Sucesso (ou o backend reconheceu o clientGeneratedId como já
          // existente — idempotência da Seção 4.2 — de qualquer forma, para
          // o app o resultado é o mesmo: pode marcar como sincronizado).
          await _lossRepository.updateStatus(
            loss.clientGeneratedId,
            status: LossSyncStatus.synced,
            lastAttemptAt: DateTime.now(),
          );
        } on SubscriptionInactiveException {
          // Empresa bloqueada (Seção 6.2): para de tentar sincronizar até que
          // a UI trate isso e o usuário veja a tela de "acesso suspenso".
          subscriptionBlocked = true;
          break;
        } on SessionExpiredException {
          // Token expirado: para o loop e sinaliza a UI (via notifyListeners
          // no finally) para forçar logout e pedir um novo login. Tentar de
          // novo sem um token novo só geraria o mesmo 401 repetidamente.
          sessionExpired = true;
          break;
        } on NetworkUnavailableException {
          // Sem internet: para o loop inteiro agora — tentar os próximos
          // itens só desperdiçaria tempo, já que todos vão falhar do mesmo jeito.
          break;
        } on ApiException catch (e) {
          // Erro do servidor (ex: validação, produto não existe mais) — fica
          // como "error" com backoff, mas não trava a fila inteira: outros
          // registros pendentes continuam sendo tentados nesta mesma passada.
          await _lossRepository.updateStatus(
            loss.clientGeneratedId,
            status: LossSyncStatus.error,
            syncAttempts: loss.syncAttempts + 1,
            lastSyncError: e.message,
            lastAttemptAt: DateTime.now(),
          );
        }
      }
    } finally {
      _isSyncing = false;
      await refreshCounts();
    }
  }

  bool _isReadyForRetry(Loss loss) {
    if (loss.syncStatus == LossSyncStatus.pending) return true;
    if (loss.lastAttemptAt == null) return true;

    final backoff = _backoffFor(loss.syncAttempts);
    return DateTime.now().difference(loss.lastAttemptAt!) >= backoff;
  }

  Duration _backoffFor(int attempts) {
    switch (attempts) {
      case 0:
        return const Duration(seconds: 30);
      case 1:
        return const Duration(minutes: 1);
      case 2:
        return const Duration(minutes: 5);
      case 3:
        return const Duration(minutes: 15);
      default:
        return const Duration(minutes: 30);
    }
  }
}

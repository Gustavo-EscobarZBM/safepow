/// Configuração de ambiente do app.
///
/// Em produção, isso normalmente viria de variáveis de build (--dart-define)
/// para permitir apontar o mesmo código para ambientes diferentes (homologação,
/// produção) sem recompilar tudo manualmente. Ex.:
///   flutter build apk --dart-define=API_BASE_URL=https://api.seusistema.com.br/api
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    // 10.0.2.2 é o alias do emulador Android para "localhost" da máquina host.
    // Em dispositivo físico, troque para o IP/domínio real do backend.
    defaultValue: 'http://10.0.2.2:3000/api',
  );

  /// Intervalo do timer de sincronização em primeiro plano (Seção 4.1).
  /// Isso cobre o app aberto; para sincronizar com o app em segundo plano de
  /// verdade, é necessário registrar tarefas nativas (WorkManager no Android,
  /// BGTaskScheduler no iOS) — ver nota em SyncQueueService.
  static const Duration foregroundSyncInterval = Duration(seconds: 30);
}

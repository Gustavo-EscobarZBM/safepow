import 'package:flutter/material.dart';
import '../../app_services.dart';
import '../../core/network/api_client.dart';
import '../../data/models/auth_session.dart';
import 'login_screen.dart';
import 'pending_sync_screen.dart';
import 'pending_verifications_screen.dart';
import 'profile_screen.dart';
import 'scan_screen.dart';
import 'subscription_blocked_screen.dart';

const _sessionExpiredMessage = 'Sessão expirada. Faça login novamente.';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _refreshingCatalog = false;
  AuthSession? _session;

  @override
  void initState() {
    super.initState();
    AppServices.syncQueueService.addListener(_onSyncStateChanged);
    _loadSession();
  }

  Future<void> _loadSession() async {
    final session = await AppServices.authRepository.currentSession();
    if (!mounted) return;
    setState(() => _session = session);
  }

  @override
  void dispose() {
    AppServices.syncQueueService.removeListener(_onSyncStateChanged);
    super.dispose();
  }

  void _onSyncStateChanged() {
    if (AppServices.syncQueueService.subscriptionBlocked && mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const SubscriptionBlockedScreen()),
        (route) => false,
      );
    }
    if (AppServices.syncQueueService.sessionExpired && mounted) {
      _goToExpiredSession();
    }
    if (mounted) setState(() {});
  }

  // Chamado tanto pela sincronização em segundo plano (via listener acima)
  // quanto por uma ação direta do usuário (_refreshCatalog) que bateu num
  // 401 — em ambos os casos o token salvo no celular não serve mais.
  Future<void> _goToExpiredSession() async {
    await AppServices.authRepository.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => const LoginScreen(sessionMessage: _sessionExpiredMessage),
      ),
      (route) => false,
    );
  }

  Future<void> _logout() async {
    await AppServices.authRepository.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  // Login e refreshFromServer() de cada catálogo já baixam produtos, motivos
  // e locais — mas isso só acontece naquele momento. Um produto cadastrado
  // depois no painel web só chega ao cache local do app quando algo dispara
  // uma nova sincronização; este botão dá ao funcionário um jeito manual de
  // fazer isso sem precisar deslogar e logar de novo.
  Future<void> _refreshCatalog() async {
    setState(() => _refreshingCatalog = true);
    try {
      await AppServices.productRepository.refreshFromServer();
      await AppServices.lossReasonRepository.refreshFromServer();
      await AppServices.lossLocationRepository.refreshFromServer();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Catálogo atualizado.')),
      );
    } on SessionExpiredException {
      await _goToExpiredSession();
    } on NetworkUnavailableException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sem conexão com a internet. Tente novamente.')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível atualizar o catálogo.')),
      );
    } finally {
      if (mounted) setState(() => _refreshingCatalog = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = AppServices.syncQueueService.pendingCount;
    final errors = AppServices.syncQueueService.errorCount;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Controle de Perdas'),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_outline),
            tooltip: 'Perfil',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ProfileScreen()),
            ),
          ),
          IconButton(icon: const Icon(Icons.logout), onPressed: _logout, tooltip: 'Sair'),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ScanScreen()),
                ),
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('Registrar nova perda'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const PendingSyncScreen()),
                ),
                icon: const Icon(Icons.sync),
                label: Text(
                  pending + errors > 0
                      ? 'Ver registros ($pending pendentes${errors > 0 ? ", $errors com erro" : ""})'
                      : 'Ver registros',
                ),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _refreshingCatalog ? null : _refreshCatalog,
                icon: _refreshingCatalog
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
                label: Text(_refreshingCatalog ? 'Atualizando...' : 'Atualizar produtos'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
              ),
              if (_session != null && (_session!.role == 'manager' || _session!.isLossVerifier)) ...[
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const PendingVerificationsScreen()),
                  ),
                  icon: const Icon(Icons.fact_check_outlined),
                  label: const Text('Conferências pendentes'),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                ),
              ],
              if (pending + errors > 0) ...[
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.cloud_queue_outlined, color: Colors.orange.shade700, size: 18),
                    const SizedBox(width: 8),
                    Text(
                      'Sincronizando automaticamente quando houver internet',
                      style: TextStyle(color: Colors.orange.shade700, fontSize: 13),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

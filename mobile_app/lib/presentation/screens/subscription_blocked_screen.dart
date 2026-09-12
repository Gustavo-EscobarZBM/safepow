import 'package:flutter/material.dart';
import '../../app_services.dart';
import 'login_screen.dart';

/// Exibida quando o backend responde 402 SUBSCRIPTION_INACTIVE — a empresa
/// está com a mensalidade em atraso além da tolerância, ou foi bloqueada
/// manualmente pelo Painel Master (Seção 6.2 do documento).
class SubscriptionBlockedScreen extends StatelessWidget {
  const SubscriptionBlockedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.lock_outline, size: 72, color: Colors.redAccent),
                const SizedBox(height: 24),
                Text(
                  'Acesso suspenso',
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                const Text(
                  'O acesso da sua empresa a este sistema está temporariamente '
                  'suspenso. Entre em contato com o setor financeiro da sua '
                  'empresa para regularizar a assinatura.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () async {
                    await AppServices.authRepository.logout();
                    AppServices.syncQueueService.subscriptionBlocked = false;
                    if (context.mounted) {
                      Navigator.of(context).pushAndRemoveUntil(
                        MaterialPageRoute(builder: (_) => const LoginScreen()),
                        (route) => false,
                      );
                    }
                  },
                  child: const Text('Sair'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

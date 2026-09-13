import 'package:flutter/material.dart';
import '../../app_services.dart';
import '../../data/models/pending_verification_loss.dart';

/// Conferência de descarte (spec seção 5) — acessível só para quem é o
/// conferente designado da empresa ou tem papel MANAGER (ver home_screen.dart).
class PendingVerificationsScreen extends StatefulWidget {
  const PendingVerificationsScreen({super.key});

  @override
  State<PendingVerificationsScreen> createState() => _PendingVerificationsScreenState();
}

class _PendingVerificationsScreenState extends State<PendingVerificationsScreen> {
  late Future<List<PendingVerificationLoss>> _future;
  final Set<String> _confirming = {};

  @override
  void initState() {
    super.initState();
    _future = AppServices.lossVerificationRepository.fetchPending();
  }

  Future<void> _confirm(PendingVerificationLoss loss, List<PendingVerificationLoss> current) async {
    setState(() => _confirming.add(loss.id));
    try {
      await AppServices.lossVerificationRepository.confirm(loss.id);
      if (!mounted) return;
      setState(() {
        current.removeWhere((l) => l.id == loss.id);
        _confirming.remove(loss.id);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _confirming.remove(loss.id));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível confirmar. Tente novamente.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Conferências pendentes')),
      body: FutureBuilder<List<PendingVerificationLoss>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Não foi possível carregar as conferências pendentes.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          final losses = snapshot.data!;
          if (losses.isEmpty) {
            return const Center(child: Text('Nenhuma perda pendente de conferência.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: losses.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final loss = losses[index];
              final confirming = _confirming.contains(loss.id);
              final hasDescription = loss.description != null && loss.description!.isNotEmpty;
              return Card(
                child: ListTile(
                  title: Text(loss.productName),
                  subtitle: Text(
                    'Qtd: ${loss.quantity.toStringAsFixed(0)} · ${loss.reportedByName}'
                    '${hasDescription ? '\n${loss.description}' : ''}',
                  ),
                  isThreeLine: hasDescription,
                  trailing: FilledButton(
                    onPressed: confirming ? null : () => _confirm(loss, losses),
                    child: confirming
                        ? const SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Confirmar'),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

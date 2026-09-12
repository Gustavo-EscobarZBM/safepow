import 'package:flutter/material.dart';
import '../../app_services.dart';
import '../../data/models/loss.dart';

class PendingSyncScreen extends StatefulWidget {
  const PendingSyncScreen({super.key});

  @override
  State<PendingSyncScreen> createState() => _PendingSyncScreenState();
}

class _PendingSyncScreenState extends State<PendingSyncScreen> {
  late Future<List<Loss>> _future;

  @override
  void initState() {
    super.initState();
    _future = AppServices.lossRepository.findAll();
  }

  Future<void> _refresh() async {
    await AppServices.syncQueueService.trySyncPending();
    setState(() => _future = AppServices.lossRepository.findAll());
  }

  IconData _iconFor(LossSyncStatus status) {
    switch (status) {
      case LossSyncStatus.synced:
        return Icons.cloud_done_outlined;
      case LossSyncStatus.error:
        return Icons.cloud_off_outlined;
      case LossSyncStatus.syncing:
        return Icons.cloud_sync_outlined;
      case LossSyncStatus.pending:
        return Icons.cloud_queue_outlined;
    }
  }

  Color _colorFor(LossSyncStatus status) {
    switch (status) {
      case LossSyncStatus.synced:
        return Colors.green;
      case LossSyncStatus.error:
        return Colors.red;
      case LossSyncStatus.syncing:
      case LossSyncStatus.pending:
        return Colors.orange;
    }
  }

  String _labelFor(LossSyncStatus status) {
    switch (status) {
      case LossSyncStatus.synced:
        return 'Sincronizado';
      case LossSyncStatus.error:
        return 'Falhou — tentando novamente';
      case LossSyncStatus.syncing:
        return 'Enviando...';
      case LossSyncStatus.pending:
        return 'Aguardando envio';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Registros e sincronização')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Loss>>(
          future: _future,
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final losses = snapshot.data!;
            if (losses.isEmpty) {
              return ListView(
                children: const [
                  Padding(
                    padding: EdgeInsets.all(32),
                    child: Text('Nenhum registro ainda.', textAlign: TextAlign.center),
                  ),
                ],
              );
            }
            return ListView.builder(
              itemCount: losses.length,
              itemBuilder: (context, index) {
                final loss = losses[index];
                return ListTile(
                  leading: Icon(_iconFor(loss.syncStatus), color: _colorFor(loss.syncStatus)),
                  title: Text(loss.productNameSnapshot),
                  subtitle: Text(
                    '${loss.locationNameSnapshot} • ${loss.occurredAt.day.toString().padLeft(2, '0')}/'
                    '${loss.occurredAt.month.toString().padLeft(2, '0')} • ${_labelFor(loss.syncStatus)}',
                  ),
                  trailing: loss.syncStatus == LossSyncStatus.error
                      ? Text('${loss.syncAttempts}x', style: const TextStyle(color: Colors.red))
                      : null,
                );
              },
            );
          },
        ),
      ),
    );
  }
}

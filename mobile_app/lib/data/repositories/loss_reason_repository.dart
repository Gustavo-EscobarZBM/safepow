import '../../core/network/api_client.dart';
import '../../core/storage/app_database.dart';
import '../models/loss_reason.dart';

/// Catálogo de motivos de perda (Cadastros > Motivo da Perda no painel do
/// gerente) — pequeno o bastante para sempre baixar por inteiro, sem a
/// sincronização incremental usada em ProductRepository.
class LossReasonRepository {
  final ApiClient _apiClient;

  LossReasonRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  Future<void> refreshFromServer() async {
    final json = await _apiClient.get('/loss-reasons');
    final reasons = (json as List).map((e) => LossReason.fromApiJson(e as Map<String, dynamic>)).toList();

    final db = await AppDatabase.instance.database;
    final batch = db.batch();
    batch.delete('loss_reasons');
    for (final reason in reasons) {
      batch.insert('loss_reasons', reason.toLocalMap());
    }
    await batch.commit(noResult: true);
  }

  Future<List<LossReason>> findAllLocal() async {
    final db = await AppDatabase.instance.database;
    final rows = await db.query('loss_reasons', orderBy: 'name ASC');
    return rows.map(LossReason.fromLocalMap).toList();
  }
}

import '../../core/network/api_client.dart';
import '../../core/storage/app_database.dart';
import '../models/loss_location.dart';

/// Catálogo de locais de ocorrência (Cadastros > Local da Perda no painel do
/// gerente) — pequeno o bastante para sempre baixar por inteiro, sem a
/// sincronização incremental usada em ProductRepository.
class LossLocationRepository {
  final ApiClient _apiClient;

  LossLocationRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  Future<void> refreshFromServer() async {
    final json = await _apiClient.get('/loss-locations');
    final locations =
        (json as List).map((e) => LossLocation.fromApiJson(e as Map<String, dynamic>)).toList();

    final db = await AppDatabase.instance.database;
    final batch = db.batch();
    batch.delete('loss_locations');
    for (final location in locations) {
      batch.insert('loss_locations', location.toLocalMap());
    }
    await batch.commit(noResult: true);
  }

  Future<List<LossLocation>> findAllLocal() async {
    final db = await AppDatabase.instance.database;
    final rows = await db.query('loss_locations', orderBy: 'name ASC');
    return rows.map(LossLocation.fromLocalMap).toList();
  }
}

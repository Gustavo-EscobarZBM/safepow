import 'package:uuid/uuid.dart';
import '../../core/storage/app_database.dart';
import '../models/loss.dart';

class LossRepository {
  final _uuid = const Uuid();

  /// Cria o registro localmente com status "pending" — a experiência do
  /// funcionário é instantânea, sem depender de internet (Seção 4.1).
  /// O clientGeneratedId (uuid v4) é gerado aqui mesmo, no celular.
  Future<Loss> registerLossLocally({
    required String productId,
    required String productName,
    required double quantity,
    required String locationId,
    required String locationName,
    required String reasonId,
    required String reasonName,
    required String description,
    String? localImagePath,
  }) async {
    final loss = Loss(
      clientGeneratedId: _uuid.v4(),
      productId: productId,
      productNameSnapshot: productName,
      quantity: quantity,
      locationId: locationId,
      locationNameSnapshot: locationName,
      reasonId: reasonId,
      reasonNameSnapshot: reasonName,
      description: description,
      localImagePath: localImagePath,
      occurredAt: DateTime.now(),
    );

    final db = await AppDatabase.instance.database;
    await db.insert('losses', loss.toLocalMap());
    return loss;
  }

  Future<List<Loss>> findPending() async {
    final db = await AppDatabase.instance.database;
    final rows = await db.query(
      'losses',
      where: 'syncStatus IN (?, ?)',
      whereArgs: [LossSyncStatus.pending.name, LossSyncStatus.error.name],
      orderBy: 'occurredAt ASC',
    );
    return rows.map(Loss.fromLocalMap).toList();
  }

  Future<List<Loss>> findAll() async {
    final db = await AppDatabase.instance.database;
    final rows = await db.query('losses', orderBy: 'occurredAt DESC');
    return rows.map(Loss.fromLocalMap).toList();
  }

  Future<void> updateUploadedImageUrl(String clientGeneratedId, String url) async {
    final db = await AppDatabase.instance.database;
    await db.update(
      'losses',
      {'uploadedImageUrl': url},
      where: 'clientGeneratedId = ?',
      whereArgs: [clientGeneratedId],
    );
  }

  Future<void> updateStatus(
    String clientGeneratedId, {
    required LossSyncStatus status,
    int? syncAttempts,
    String? lastSyncError,
    DateTime? lastAttemptAt,
  }) async {
    final db = await AppDatabase.instance.database;
    await db.update(
      'losses',
      {
        'syncStatus': status.name,
        if (syncAttempts != null) 'syncAttempts': syncAttempts,
        'lastSyncError': lastSyncError,
        if (lastAttemptAt != null) 'lastAttemptAt': lastAttemptAt.toIso8601String(),
      },
      where: 'clientGeneratedId = ?',
      whereArgs: [clientGeneratedId],
    );
  }
}

/// Status do registro na fila de sincronização local (Seção 4.1 do documento).
enum LossSyncStatus { pending, syncing, synced, error }

LossSyncStatus lossSyncStatusFromString(String value) {
  return LossSyncStatus.values.firstWhere(
    (e) => e.name == value,
    orElse: () => LossSyncStatus.pending,
  );
}

class Loss {
  /// Gerado no próprio celular (uuid v4) no momento da criação — é a chave de
  /// idempotência que o backend usa para nunca duplicar um registro reenviado
  /// após uma falha de conexão (Seção 4.2 do documento de arquitetura).
  final String clientGeneratedId;
  final String productId;
  final String productNameSnapshot; // guardado localmente só para exibição na lista
  final double quantity;
  // locationId/reasonId referenciam os catálogos cadastrados pelo gerente
  // (Cadastros > Local/Motivo da Perda) — o backend exige UUIDs desses
  // catálogos, não texto livre. Os *NameSnapshot guardam o nome só para
  // exibição na lista de pendências, sem precisar de join com o cache local.
  final String locationId;
  final String locationNameSnapshot;
  final String reasonId;
  final String reasonNameSnapshot;
  final String description;
  final String? localImagePath; // caminho no armazenamento local do celular
  final String? uploadedImageUrl; // preenchido após o upload da foto ter sucesso
  final DateTime occurredAt;
  final LossSyncStatus syncStatus;
  final int syncAttempts;
  final String? lastSyncError;
  final DateTime? lastAttemptAt;

  Loss({
    required this.clientGeneratedId,
    required this.productId,
    required this.productNameSnapshot,
    required this.quantity,
    required this.locationId,
    required this.locationNameSnapshot,
    required this.reasonId,
    required this.reasonNameSnapshot,
    required this.description,
    required this.occurredAt,
    this.localImagePath,
    this.uploadedImageUrl,
    this.syncStatus = LossSyncStatus.pending,
    this.syncAttempts = 0,
    this.lastSyncError,
    this.lastAttemptAt,
  });

  Loss copyWith({
    LossSyncStatus? syncStatus,
    int? syncAttempts,
    String? lastSyncError,
    DateTime? lastAttemptAt,
    String? uploadedImageUrl,
  }) {
    return Loss(
      clientGeneratedId: clientGeneratedId,
      productId: productId,
      productNameSnapshot: productNameSnapshot,
      quantity: quantity,
      locationId: locationId,
      locationNameSnapshot: locationNameSnapshot,
      reasonId: reasonId,
      reasonNameSnapshot: reasonNameSnapshot,
      description: description,
      occurredAt: occurredAt,
      localImagePath: localImagePath,
      uploadedImageUrl: uploadedImageUrl ?? this.uploadedImageUrl,
      syncStatus: syncStatus ?? this.syncStatus,
      syncAttempts: syncAttempts ?? this.syncAttempts,
      lastSyncError: lastSyncError ?? this.lastSyncError,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
    );
  }

  factory Loss.fromLocalMap(Map<String, dynamic> map) {
    return Loss(
      clientGeneratedId: map['clientGeneratedId'] as String,
      productId: map['productId'] as String,
      productNameSnapshot: map['productNameSnapshot'] as String,
      quantity: (map['quantity'] as num).toDouble(),
      locationId: map['locationId'] as String,
      locationNameSnapshot: map['locationNameSnapshot'] as String,
      reasonId: map['reasonId'] as String,
      reasonNameSnapshot: map['reasonNameSnapshot'] as String,
      description: map['description'] as String,
      localImagePath: map['localImagePath'] as String?,
      uploadedImageUrl: map['uploadedImageUrl'] as String?,
      occurredAt: DateTime.parse(map['occurredAt'] as String),
      syncStatus: lossSyncStatusFromString(map['syncStatus'] as String),
      syncAttempts: map['syncAttempts'] as int,
      lastSyncError: map['lastSyncError'] as String?,
      lastAttemptAt:
          map['lastAttemptAt'] != null ? DateTime.parse(map['lastAttemptAt'] as String) : null,
    );
  }

  Map<String, dynamic> toLocalMap() {
    return {
      'clientGeneratedId': clientGeneratedId,
      'productId': productId,
      'productNameSnapshot': productNameSnapshot,
      'quantity': quantity,
      'locationId': locationId,
      'locationNameSnapshot': locationNameSnapshot,
      'reasonId': reasonId,
      'reasonNameSnapshot': reasonNameSnapshot,
      'description': description,
      'localImagePath': localImagePath,
      'uploadedImageUrl': uploadedImageUrl,
      'occurredAt': occurredAt.toIso8601String(),
      'syncStatus': syncStatus.name,
      'syncAttempts': syncAttempts,
      'lastSyncError': lastSyncError,
      'lastAttemptAt': lastAttemptAt?.toIso8601String(),
    };
  }

  /// Corpo enviado ao endpoint POST /losses do backend.
  Map<String, dynamic> toApiJson() {
    return {
      'clientGeneratedId': clientGeneratedId,
      'productId': productId,
      'quantity': quantity,
      'locationId': locationId,
      'reasonId': reasonId,
      'description': description,
      'imageUrl': uploadedImageUrl,
      'occurredAt': occurredAt.toIso8601String(),
      // Sempre 'mobile' — é este cliente quem está enviando. Alimenta a
      // coluna "Origem" na tela de perdas do painel web.
      'source': 'mobile',
    };
  }
}

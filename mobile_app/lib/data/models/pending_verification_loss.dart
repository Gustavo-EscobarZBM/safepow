class PendingVerificationLoss {
  final String id;
  final String productName;
  final double quantity;
  final String reportedByName;
  final String? description;
  final DateTime occurredAt;

  PendingVerificationLoss({
    required this.id,
    required this.productName,
    required this.quantity,
    required this.reportedByName,
    required this.description,
    required this.occurredAt,
  });

  factory PendingVerificationLoss.fromApiJson(Map<String, dynamic> json) {
    final product = json['product'] as Map<String, dynamic>?;
    final reportedBy = json['reportedBy'] as Map<String, dynamic>?;
    return PendingVerificationLoss(
      id: json['id'] as String,
      productName: product?['name'] as String? ?? 'Produto',
      quantity: double.tryParse(json['quantity'].toString()) ?? 1,
      reportedByName: reportedBy?['name'] as String? ?? 'Funcionário',
      description: json['description'] as String?,
      occurredAt: DateTime.parse(json['occurredAt'] as String),
    );
  }
}

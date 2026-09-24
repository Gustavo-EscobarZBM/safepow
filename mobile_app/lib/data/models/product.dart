class Product {
  final String id;
  final String barcode;
  final String? sku;
  final String name;
  final double unitPrice;

  /// false = produto arquivado (tombstone do sync — SP1, 6.2). O banco local só guarda ativos.
  final bool isActive;

  Product({
    required this.id,
    required this.barcode,
    required this.name,
    required this.unitPrice,
    this.sku,
    this.isActive = true,
  });

  factory Product.fromApiJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] as String,
      barcode: json['barcode'] as String,
      sku: json['sku'] as String?,
      name: json['name'] as String,
      unitPrice: double.tryParse(json['unitPrice'].toString()) ?? 0,
      isActive: json['isActive'] as bool? ?? true,
    );
  }

  factory Product.fromLocalMap(Map<String, dynamic> map) {
    return Product(
      id: map['id'] as String,
      barcode: map['barcode'] as String,
      sku: map['sku'] as String?,
      name: map['name'] as String,
      unitPrice: (map['unitPrice'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toLocalMap() {
    return {
      'id': id,
      'barcode': barcode,
      'sku': sku,
      'name': name,
      'unitPrice': unitPrice,
    };
  }
}

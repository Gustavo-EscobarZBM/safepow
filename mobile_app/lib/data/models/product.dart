class Product {
  final String id;
  final String barcode;
  final String? sku;
  final String name;
  final double unitPrice;

  Product({
    required this.id,
    required this.barcode,
    required this.name,
    required this.unitPrice,
    this.sku,
  });

  factory Product.fromApiJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] as String,
      barcode: json['barcode'] as String,
      sku: json['sku'] as String?,
      name: json['name'] as String,
      unitPrice: double.tryParse(json['unitPrice'].toString()) ?? 0,
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

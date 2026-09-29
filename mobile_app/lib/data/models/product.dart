class Product {
  final String id;
  final String barcode;
  final String? sku;
  final String name;
  final double unitPrice;

  /// Unidade de venda (SP4 4.1): UN, KG, G, L, ML, CX, PCT, DZ, M. Servidor antigo não manda ⇒ UN.
  final String unit;

  /// URL da foto do produto (SP4 4.1); sem internet a tela mostra só o nome.
  final String? imageUrl;

  final bool isPerishable;

  /// false = produto arquivado (tombstone do sync — SP1, 6.2). O banco local só guarda ativos.
  final bool isActive;

  Product({
    required this.id,
    required this.barcode,
    required this.name,
    required this.unitPrice,
    this.sku,
    this.unit = 'UN',
    this.imageUrl,
    this.isPerishable = false,
    this.isActive = true,
  });

  static const fractionalUnits = {'KG', 'G', 'L', 'ML', 'M'};

  /// Quantidade da perda pode ter casas decimais (0,850 kg).
  bool get isFractional => fractionalUnits.contains(unit);

  factory Product.fromApiJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] as String,
      barcode: json['barcode'] as String,
      sku: json['sku'] as String?,
      name: json['name'] as String,
      unitPrice: double.tryParse(json['unitPrice'].toString()) ?? 0,
      unit: json['unit'] as String? ?? 'UN',
      imageUrl: json['imageUrl'] as String?,
      isPerishable: json['isPerishable'] as bool? ?? false,
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
      unit: map['unit'] as String? ?? 'UN',
      imageUrl: map['imageUrl'] as String?,
      isPerishable: (map['isPerishable'] as int? ?? 0) == 1,
    );
  }

  Map<String, dynamic> toLocalMap() {
    return {
      'id': id,
      'barcode': barcode,
      'sku': sku,
      'name': name,
      'unitPrice': unitPrice,
      'unit': unit,
      'imageUrl': imageUrl,
      'isPerishable': isPerishable ? 1 : 0,
    };
  }
}

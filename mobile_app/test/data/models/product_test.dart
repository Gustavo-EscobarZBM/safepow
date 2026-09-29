import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/data/models/product.dart';

void main() {
  group('Product — dados de catálogo (SP4 4.1)', () {
    test('resposta antiga sem unidade vira UN, sem foto, não perecível', () {
      final product = Product.fromApiJson({'id': 'p', 'barcode': '1', 'name': 'Arroz', 'unitPrice': '10.00'});
      expect(product.unit, 'UN');
      expect(product.imageUrl, isNull);
      expect(product.isPerishable, isFalse);
      expect(product.isFractional, isFalse);
    });

    test('KG é fracionável e os campos vão e voltam do banco local', () {
      final product = Product.fromApiJson({
        'id': 'p',
        'barcode': '2',
        'name': 'Patinho',
        'unitPrice': '39.90',
        'unit': 'KG',
        'imageUrl': 'https://cdn/p.jpg',
        'isPerishable': true,
      });
      expect(product.isFractional, isTrue);

      final local = Product.fromLocalMap(product.toLocalMap());
      expect(local.unit, 'KG');
      expect(local.imageUrl, 'https://cdn/p.jpg');
      expect(local.isPerishable, isTrue);
    });
  });
}

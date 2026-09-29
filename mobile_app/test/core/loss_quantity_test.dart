import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/core/util/loss_quantity.dart';

void main() {
  group('validateLossQuantity (SP4 4.1)', () {
    test('produto por kg aceita decimal com vírgula', () {
      expect(validateLossQuantity('0,850', fractional: true), isNull);
      expect(parseLossQuantity('0,850'), 0.85);
    });

    test('produto por unidade recusa decimal', () {
      expect(validateLossQuantity('1,5', fractional: false), 'Quantidade inteira para esta unidade.');
      expect(validateLossQuantity('2', fractional: false), isNull);
    });

    test('vazio, zero, negativo ou texto é inválido', () {
      for (final text in ['', '0', '-1', 'abc', null]) {
        expect(validateLossQuantity(text, fractional: true), 'Informe uma quantidade válida');
      }
    });
  });
}

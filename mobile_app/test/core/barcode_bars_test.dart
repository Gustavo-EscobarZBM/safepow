import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/core/util/barcode_bars.dart';

void main() {
  test('é determinístico para a mesma semente', () {
    expect(buildBarcodeBars(7, 300), buildBarcodeBars(7, 300));
  });

  test('gera padrões diferentes para sementes diferentes', () {
    expect(buildBarcodeBars(7, 300), isNot(buildBarcodeBars(11, 300)));
  });

  test('mantém todas as barras dentro da largura', () {
    for (final bar in buildBarcodeBars(7, 300)) {
      expect(bar.x, greaterThanOrEqualTo(0));
      expect(bar.x + bar.width, lessThanOrEqualTo(300));
    }
  });

  test('nunca sobrepõe duas barras e deixa um vão entre elas', () {
    final bars = buildBarcodeBars(7, 300);
    for (var i = 1; i < bars.length; i++) {
      expect(bars[i].x, greaterThan(bars[i - 1].x + bars[i - 1].width));
    }
  });

  test('preenche a largura com um padrão denso de código de barras', () {
    expect(buildBarcodeBars(7, 300).length, greaterThan(25));
  });
}

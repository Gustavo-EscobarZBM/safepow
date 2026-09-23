import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/core/util/greeting.dart';

void main() {
  test('cumprimenta com "Bom dia" das 5h às 11h', () {
    expect(greetingForHour(5), 'Bom dia');
    expect(greetingForHour(11), 'Bom dia');
  });

  test('cumprimenta com "Boa tarde" das 12h às 17h', () {
    expect(greetingForHour(12), 'Boa tarde');
    expect(greetingForHour(17), 'Boa tarde');
  });

  test('cumprimenta com "Boa noite" das 18h até as 4h', () {
    expect(greetingForHour(18), 'Boa noite');
    expect(greetingForHour(23), 'Boa noite');
    expect(greetingForHour(0), 'Boa noite');
    expect(greetingForHour(4), 'Boa noite');
  });
}

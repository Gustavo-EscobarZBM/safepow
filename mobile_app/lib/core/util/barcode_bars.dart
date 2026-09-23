/// Barra do código de barras decorativo da tela de login.
typedef BarcodeBar = ({int x, int width});

/// Padrão de barras determinístico: a mesma semente sempre gera o mesmo desenho
/// (mesma regra do painel web, para as duas telas de login ficarem iguais).
List<BarcodeBar> buildBarcodeBars(int seed, int totalWidth) {
  var state = seed % 233280;
  if (state == 0) state = 1;
  double next() {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  }

  final bars = <BarcodeBar>[];
  var x = 0;
  while (true) {
    final width = 1 + (next() * 4).floor();
    final gap = 1 + (next() * 3).floor();
    if (x + width > totalWidth) break;
    bars.add((x: x, width: width));
    x += width + gap;
  }
  return bars;
}

export interface BarcodeBar {
  x: number;
  width: number;
}

// Padrão de barras determinístico (mesma semente = mesmo desenho), para o SSR e o
// cliente renderizarem exatamente igual — sem Math.random(), que causaria mismatch de hidratação.
export function buildBarcodeBars(seed: number, totalWidth: number): BarcodeBar[] {
  let state = seed % 233280 || 1;
  const next = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };

  const bars: BarcodeBar[] = [];
  let x = 0;
  for (;;) {
    const width = 1 + Math.floor(next() * 4);
    const gap = 1 + Math.floor(next() * 3);
    if (x + width > totalWidth) break;
    bars.push({ x, width });
    x += width + gap;
  }
  return bars;
}

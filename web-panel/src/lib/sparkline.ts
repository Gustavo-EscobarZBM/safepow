export interface SparklinePoint {
  x: number;
  y: number;
}

export function buildSparklinePoints(values: number[], width: number, height: number): SparklinePoint[] {
  if (values.length < 2) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const stepX = width / (values.length - 1);

  return values.map((value, index) => {
    const normalized = range === 0 ? 0.5 : (value - min) / range;
    return {
      x: index * stepX,
      y: height - normalized * height,
    };
  });
}

export function pointsToPolyline(points: SparklinePoint[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

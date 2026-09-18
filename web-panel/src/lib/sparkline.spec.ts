import { describe, expect, it } from 'vitest';
import { buildSparklinePoints, pointsToPolyline } from './sparkline';

describe('buildSparklinePoints', () => {
  it('returns an empty array for fewer than 2 values', () => {
    expect(buildSparklinePoints([], 100, 40)).toEqual([]);
    expect(buildSparklinePoints([5], 100, 40)).toEqual([]);
  });

  it('spaces points evenly across the given width', () => {
    const points = buildSparklinePoints([1, 2, 3, 4], 90, 40);
    expect(points.map((p) => p.x)).toEqual([0, 30, 60, 90]);
  });

  it('maps the highest value to y=0 and the lowest value to y=height', () => {
    const points = buildSparklinePoints([10, 50, 20], 100, 40);
    expect(points[1].y).toBe(0);
    expect(points[0].y).toBe(40);
  });

  it('centers all points vertically when every value is equal', () => {
    const points = buildSparklinePoints([7, 7, 7], 60, 40);
    expect(points.every((p) => p.y === 20)).toBe(true);
  });
});

describe('pointsToPolyline', () => {
  it('joins points into an SVG polyline points string', () => {
    expect(
      pointsToPolyline([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toBe('0.0,0.0 10.0,20.0');
  });
});

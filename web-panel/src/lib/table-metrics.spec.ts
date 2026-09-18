import { describe, expect, it } from 'vitest';
import { percentOfTotal } from './table-metrics';

describe('percentOfTotal', () => {
  it('returns the value as a percentage of the total', () => {
    expect(percentOfTotal(25, 100)).toBe(25);
  });

  it('returns 0 when total is zero', () => {
    expect(percentOfTotal(10, 0)).toBe(0);
  });

  it('returns 0 when total is negative', () => {
    expect(percentOfTotal(10, -5)).toBe(0);
  });

  it('clamps to 100 when value exceeds total', () => {
    expect(percentOfTotal(150, 100)).toBe(100);
  });

  it('clamps to 0 when value is negative', () => {
    expect(percentOfTotal(-10, 100)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { buildBarcodeBars } from './barcode';

describe('buildBarcodeBars', () => {
  it('is deterministic for the same seed', () => {
    expect(buildBarcodeBars(7, 300)).toEqual(buildBarcodeBars(7, 300));
  });

  it('produces different patterns for different seeds', () => {
    expect(buildBarcodeBars(7, 300)).not.toEqual(buildBarcodeBars(11, 300));
  });

  it('keeps every bar inside the given width', () => {
    for (const bar of buildBarcodeBars(7, 300)) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(300);
    }
  });

  it('never overlaps two bars and leaves a gap between them', () => {
    const bars = buildBarcodeBars(7, 300);

    for (let i = 1; i < bars.length; i += 1) {
      expect(bars[i].x).toBeGreaterThan(bars[i - 1].x + bars[i - 1].width);
    }
  });

  it('fills the width with a dense, barcode-like pattern', () => {
    expect(buildBarcodeBars(7, 300).length).toBeGreaterThan(25);
  });
});

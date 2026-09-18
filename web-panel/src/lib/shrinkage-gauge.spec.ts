import { describe, expect, it } from 'vitest';
import { shrinkageGaugeStatus } from './shrinkage-gauge';

describe('shrinkageGaugeStatus', () => {
  it('returns unknown with zero angle when rate is null', () => {
    expect(shrinkageGaugeStatus(null)).toEqual({ status: 'unknown', angleDeg: 0, label: 'Sem dado' });
  });

  it('classifies rate at or below 1% as good', () => {
    expect(shrinkageGaugeStatus(0.5)).toMatchObject({ status: 'good', label: 'Saudável' });
    expect(shrinkageGaugeStatus(1)).toMatchObject({ status: 'good', label: 'Saudável' });
  });

  it('classifies rate between 1% and 2% as warning', () => {
    expect(shrinkageGaugeStatus(1.5)).toMatchObject({ status: 'warning', label: 'Atenção' });
    expect(shrinkageGaugeStatus(2)).toMatchObject({ status: 'warning', label: 'Atenção' });
  });

  it('classifies rate above 2% as critical', () => {
    expect(shrinkageGaugeStatus(2.1)).toMatchObject({ status: 'critical', label: 'Alto' });
  });

  it('maps 0% to a 0 degree angle and the 4% ceiling to 180 degrees', () => {
    expect(shrinkageGaugeStatus(0).angleDeg).toBe(0);
    expect(shrinkageGaugeStatus(4).angleDeg).toBe(180);
  });

  it('clamps the angle at 180 degrees above the 4% ceiling', () => {
    expect(shrinkageGaugeStatus(9).angleDeg).toBe(180);
  });
});

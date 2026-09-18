export type ShrinkageStatus = 'good' | 'warning' | 'critical' | 'unknown';

export interface ShrinkageGaugeState {
  status: ShrinkageStatus;
  angleDeg: number;
  label: string;
}

const MAX_RATE = 4;

export function shrinkageGaugeStatus(rate: number | null): ShrinkageGaugeState {
  if (rate === null) {
    return { status: 'unknown', angleDeg: 0, label: 'Sem dado' };
  }

  const clamped = Math.min(MAX_RATE, Math.max(0, rate));
  const angleDeg = (clamped / MAX_RATE) * 180;

  if (rate <= 1) return { status: 'good', angleDeg, label: 'Saudável' };
  if (rate <= 2) return { status: 'warning', angleDeg, label: 'Atenção' };
  return { status: 'critical', angleDeg, label: 'Alto' };
}

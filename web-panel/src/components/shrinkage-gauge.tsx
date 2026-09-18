import { shrinkageGaugeStatus } from '@/lib/shrinkage-gauge';
import { cn } from '@/lib/utils';

const STATUS_COLOR: Record<string, string> = {
  good: 'stroke-success text-success-foreground',
  warning: 'stroke-warning text-warning-foreground',
  critical: 'stroke-destructive text-destructive',
  unknown: 'stroke-muted-foreground text-muted-foreground',
};

function arcPoint(angleDeg: number, radius: number, cx: number, cy: number) {
  const rad = (Math.PI * angleDeg) / 180;
  return { x: cx - radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
}

export function ShrinkageGauge({ rate }: { rate: number | null }) {
  const { status, angleDeg, label } = shrinkageGaugeStatus(rate);
  const cx = 60;
  const cy = 56;
  const radius = 48;
  const start = arcPoint(0, radius, cx, cy);
  const end = arcPoint(angleDeg, radius, cx, cy);

  return (
    <div className="flex flex-col items-center gap-1" data-testid="shrinkage-gauge" data-status={status}>
      <svg viewBox="0 0 120 64" className="h-16 w-28">
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          strokeWidth={8}
          className="stroke-muted"
          strokeLinecap="round"
        />
        {angleDeg > 0 && (
          <path
            d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`}
            fill="none"
            strokeWidth={8}
            className={cn(STATUS_COLOR[status])}
            strokeLinecap="round"
          />
        )}
      </svg>
      <p className={cn('text-sm font-medium', STATUS_COLOR[status])}>
        {rate === null ? label : `${rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · ${label}`}
      </p>
    </div>
  );
}

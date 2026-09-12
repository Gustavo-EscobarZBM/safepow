import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function KpiCard({
  label,
  value,
  hint,
  variationPercent,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Variação percentual vs. período anterior. Positivo = piora (mais prejuízo). */
  variationPercent?: number | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-display text-2xl text-foreground">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        {variationPercent !== undefined && variationPercent !== null ? (
          <VariationBadge percent={variationPercent} />
        ) : (
          hint && <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function VariationBadge({ percent }: { percent: number }) {
  const isFlat = Math.abs(percent) < 0.5;
  const isWorse = percent > 0; // mais prejuízo que o período anterior
  const Icon = isFlat ? Minus : isWorse ? TrendingUp : TrendingDown;

  return (
    <p
      className={cn(
        'flex items-center gap-1 text-xs font-medium',
        isFlat ? 'text-muted-foreground' : isWorse ? 'text-destructive' : 'text-emerald-600',
      )}
    >
      <Icon className="size-3.5" />
      {Math.abs(percent).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. mês anterior
    </p>
  );
}

'use client';

import type { ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { formatBRL } from '@/lib/format';
import { buildSparklinePoints, pointsToPolyline } from '@/lib/sparkline';
import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

export interface DashboardHeroProps {
  totalFinancialLoss: number;
  previousMonthTotal: number;
  variationPercent: number | null;
  trendData: { totalFinancialLoss: string | number }[];
  projected: { totalFinancialLoss: number; financialVariationPercent: number | null } | null;
  filters?: ReactNode;
}

const SPARK_WIDTH = 220;
const SPARK_HEIGHT = 48;

function HeroVariation({ percent }: { percent: number }) {
  const isFlat = Math.abs(percent) < 0.5;
  const isWorse = percent > 0;
  const Icon = isFlat ? Minus : isWorse ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        isFlat ? 'text-sidebar-foreground/70' : isWorse ? 'text-red-400' : 'text-success',
      )}
    >
      <Icon className="size-3.5" />
      {`${Math.abs(percent).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs. mês anterior`}
    </span>
  );
}

export function DashboardHero({
  totalFinancialLoss,
  previousMonthTotal,
  variationPercent,
  trendData,
  projected,
  filters,
}: DashboardHeroProps) {
  const animatedValue = useCountUp(totalFinancialLoss);
  const sparkValues = trendData.map((row) => Number(row.totalFinancialLoss));
  const points = buildSparklinePoints(sparkValues, SPARK_WIDTH, SPARK_HEIGHT);

  return (
    <div className="overflow-hidden rounded-xl bg-sidebar p-6 text-sidebar-foreground print:bg-transparent print:text-foreground print:ring-1 print:ring-border sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-sidebar-foreground/70">Prejuízo total no mês (venda)</p>
          <p className="font-display text-4xl sm:text-5xl" data-testid="hero-value">
            {formatBRL(animatedValue)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-sidebar-foreground/80">
            <span data-testid="hero-comparison">Mês anterior: {formatBRL(previousMonthTotal)}</span>
            {variationPercent !== null && <HeroVariation percent={variationPercent} />}
          </div>
          {projected && projected.totalFinancialLoss > 0 && (
            <p className="mt-2 text-sm text-sidebar-foreground/70" data-testid="hero-projected">
              Projeção de fechamento: {formatBRL(projected.totalFinancialLoss)}
              {projected.financialVariationPercent !== null && (
                <>
                  {' '}
                  ({projected.financialVariationPercent > 0 ? '+' : ''}
                  {projected.financialVariationPercent.toLocaleString('pt-BR', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  %)
                </>
              )}
            </p>
          )}
        </div>

        {points.length > 0 && (
          <svg
            viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
            className="h-12 w-full max-w-[220px] text-sidebar-primary print:hidden"
            role="img"
            aria-label="Tendência do prejuízo no período"
          >
            <polyline
              points={pointsToPolyline(points)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {filters && <div className="mt-6 border-t border-sidebar-border/60 pt-4">{filters}</div>}
    </div>
  );
}

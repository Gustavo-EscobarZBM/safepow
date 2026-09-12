'use client';

import { useMemo } from 'react';
import { Cell, Pie, PieChart } from 'recharts';
import type { LossByLocationRow, LossByReasonRow } from '@/lib/types';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const SLICE_COLORS = [
  'rgb(var(--chart-1))',
  'rgb(var(--chart-2))',
  'rgb(var(--chart-3))',
  'rgb(var(--chart-4))',
  'rgb(var(--chart-5))',
];

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function LossesBreakdownChart({
  byReason,
  byLocation,
  view,
}: {
  byReason: LossByReasonRow[];
  byLocation: LossByLocationRow[];
  view: 'reason' | 'location';
}) {
  const rows = view === 'reason' ? byReason : byLocation;

  const chartData = useMemo(
    () =>
      rows.map((row, i) => ({
        label: row.label,
        value: Number(row.totalFinancialLoss),
        fill: SLICE_COLORS[i % SLICE_COLORS.length],
      })),
    [rows],
  );

  const chartConfig = useMemo(
    () =>
      Object.fromEntries(chartData.map((row) => [row.label, { label: row.label, color: row.fill }])) as ChartConfig,
    [chartData],
  );

  return (
    <div className="space-y-4">
      {chartData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Nenhuma perda registrada no período selecionado.
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-64">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatBRL(Number(value))} hideLabel />} />
            <Pie data={chartData} dataKey="value" nameKey="label" innerRadius={55} outerRadius={90} strokeWidth={2}>
              {chartData.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      )}

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {chartData.map((row) => (
          <li key={row.label} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.fill }} />
            <span className="truncate">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

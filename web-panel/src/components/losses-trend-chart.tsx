'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { LossByPeriodRow } from '@/lib/types';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { formatBRL, formatDateShortBR } from '@/lib/format';

const chartConfig = {
  totalFinancialLoss: {
    label: 'Prejuízo financeiro',
    color: 'rgb(var(--chart-1))',
  },
} satisfies ChartConfig;

export function LossesTrendChart({ data }: { data: LossByPeriodRow[] }) {
  const chartData = data.map((row) => ({
    date: row.date,
    totalFinancialLoss: Number(row.totalFinancialLoss),
  }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        Nenhuma perda registrada no período selecionado.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <defs>
          <linearGradient id="fillFinancialLoss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-totalFinancialLoss)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-totalFinancialLoss)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgb(var(--border))" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateShortBR}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => formatBRL(v, { maximumFractionDigits: 0 })}
          tickLine={false}
          axisLine={false}
          width={80}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatDateShortBR(payload?.[0]?.payload?.date)}
              formatter={(value) => formatBRL(Number(value), { maximumFractionDigits: 0 })}
            />
          }
        />
        <Area
          dataKey="totalFinancialLoss"
          type="monotone"
          fill="url(#fillFinancialLoss)"
          stroke="var(--color-totalFinancialLoss)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

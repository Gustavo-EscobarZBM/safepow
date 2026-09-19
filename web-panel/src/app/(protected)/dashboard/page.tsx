'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, Printer, Search } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import type {
  CompanyMonthlyRevenue,
  LossAlert,
  LossByLocationRow,
  LossByPeriodRow,
  LossByProductReportRow,
  LossByReasonRow,
  LossSummaryReport,
  SuspiciousPatternEntry,
} from '@/lib/types';
import { AlertsCard } from '@/components/alerts-card';
import { DashboardHero } from '@/components/dashboard-hero';
import { KpiTile } from '@/components/kpi-card';
import { LossesTrendChart } from '@/components/losses-trend-chart';
import { LossesBreakdownChart } from '@/components/losses-breakdown-chart';
import { ShrinkageGauge } from '@/components/shrinkage-gauge';
import { SuspiciousPatternsCard } from '@/components/suspicious-patterns-card';
import { TopOffendersTable } from '@/components/top-offenders-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

function toDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const QUICK_PERIODS = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
];

export default function DashboardPage() {
  const [summary, setSummary] = useState<LossSummaryReport | null>(null);
  const [alerts, setAlerts] = useState<LossAlert[]>([]);
  const [suspiciousPatterns, setSuspiciousPatterns] = useState<SuspiciousPatternEntry[]>([]);
  const [byProduct, setByProduct] = useState<LossByProductReportRow[]>([]);
  const [byPeriod, setByPeriod] = useState<LossByPeriodRow[]>([]);
  const [byReason, setByReason] = useState<LossByReasonRow[]>([]);
  const [byLocation, setByLocation] = useState<LossByLocationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [quickPeriod, setQuickPeriod] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [compositionView, setCompositionView] = useState<'reason' | 'location'>('reason');
  const [productQuery, setProductQuery] = useState('');
  const now = useMemo(() => new Date(), []);
  const [revenueInput, setRevenueInput] = useState('');
  const [revenueSaving, setRevenueSaving] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  function buildQuery(fromValue: string, toValue: string) {
    const params = new URLSearchParams();
    if (fromValue) params.set('from', new Date(fromValue).toISOString());
    if (toValue) params.set('to', new Date(toValue).toISOString());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function loadFilteredReports(fromValue = from, toValue = to) {
    const qs = buildQuery(fromValue, toValue);
    Promise.all([
      api.get<LossByProductReportRow[]>(`losses/reports/by-product${qs}`),
      api.get<LossByPeriodRow[]>(`losses/reports/by-period${qs}`),
      api.get<LossByReasonRow[]>(`losses/reports/by-reason${qs}`),
      api.get<LossByLocationRow[]>(`losses/reports/by-location${qs}`),
    ])
      .then(([product, period, reason, location]) => {
        setByProduct(product);
        setByPeriod(period);
        setByReason(reason);
        setByLocation(location);
        setError(null);
        setLastUpdatedAt(new Date());
      })
      .catch((e: ApiError) => setError(e.message));
  }

  function loadDashboardData() {
    setLoading(true);
    setInitialError(null);
    Promise.all([
      api.get<LossSummaryReport>('losses/reports/summary'),
      api.get<LossAlert[]>('losses/reports/alerts'),
      api.get<SuspiciousPatternEntry[]>('losses/reports/suspicious-patterns'),
      api.get<CompanyMonthlyRevenue | null>(`company-revenue?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
    ])
      .then(([summaryData, alertsData, patternsData, revenue]) => {
        setSummary(summaryData);
        setAlerts(alertsData);
        setSuspiciousPatterns(patternsData);
        setRevenueInput(revenue ? String(revenue.revenueAmount) : '');
      })
      .catch((e: ApiError) => setInitialError(e.message))
      .finally(() => setLoading(false));
    loadFilteredReports('', '');
  }

  useEffect(() => {
    loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQuickPeriod(label: string) {
    setQuickPeriod(label);
    const days = QUICK_PERIODS.find((p) => p.label === label)?.days;
    if (!days) return;
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    const fromStr = toDateInputValue(fromDate);
    const toStr = toDateInputValue(toDate);
    setFrom(fromStr);
    setTo(toStr);
    loadFilteredReports(fromStr, toStr);
  }

  function exportReport() {
    const total = byProduct.reduce((sum, row) => sum + Number(row.totalFinancialLoss), 0);
    const header = ['Produto', 'Quantidade', 'Prejuízo', '% do total'];
    const body = byProduct.map((row) => {
      const loss = Number(row.totalFinancialLoss);
      const percent = total === 0 ? 0 : (loss / total) * 100;
      return [row.productName, row.totalQuantity, loss.toFixed(2), percent.toFixed(1)];
    });
    const csv = [header, ...body].map((row) => row.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'relatorio-perdas-safepow.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveRevenue() {
    const amount = Number(revenueInput.replace(',', '.'));
    if (!revenueInput || Number.isNaN(amount) || amount < 0) {
      setRevenueError('Informe um valor válido.');
      return;
    }
    setRevenueSaving(true);
    setRevenueError(null);
    try {
      await api.put(`company-revenue/${now.getFullYear()}/${now.getMonth() + 1}`, { revenueAmount: amount });
      const updatedSummary = await api.get<LossSummaryReport>('losses/reports/summary');
      setSummary(updatedSummary);
    } catch (e) {
      setRevenueError(e instanceof ApiError ? e.message : 'Erro ao salvar faturamento.');
    } finally {
      setRevenueSaving(false);
    }
  }

  const topProduct = byProduct.length > 0 ? byProduct[0].productName : '—';
  const topReason = byReason.length > 0 ? byReason[0].label : '—';

  const filteredByProduct = useMemo(() => {
    const term = productQuery.trim().toLowerCase();
    if (!term) return byProduct;
    return byProduct.filter((row) => row.productName.toLowerCase().includes(term));
  }, [byProduct, productQuery]);

  const periodFilters = (
    <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
      <div className="space-y-1.5">
        <Label className="text-sidebar-foreground/70">Período rápido</Label>
        <Tabs value={quickPeriod ?? undefined} onValueChange={handleQuickPeriod}>
          <TabsList>
            {QUICK_PERIODS.map((preset) => (
              <TabsTrigger key={preset.label} value={preset.label}>
                {preset.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="space-y-1.5">
        <Label className="text-sidebar-foreground/70">De</Label>
        <div className="relative w-fit">
          <Input
            type="date"
            className="w-auto pr-9"
            value={from}
            onChange={(e) => {
              setQuickPeriod(null);
              setFrom(e.target.value);
            }}
          />
          <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-sidebar-foreground/70">Até</Label>
        <div className="relative w-fit">
          <Input
            type="date"
            className="w-auto pr-9"
            value={to}
            onChange={(e) => {
              setQuickPeriod(null);
              setTo(e.target.value);
            }}
          />
          <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
      <Button variant="outline" className="text-foreground" onClick={() => loadFilteredReports()}>
        Filtrar período
      </Button>
      {(from || to) && (
        <Button
          variant="ghost"
          onClick={() => {
            setFrom('');
            setTo('');
            setQuickPeriod(null);
            loadFilteredReports('', '');
          }}
        >
          Limpar filtro
        </Button>
      )}
      {lastUpdatedAt && (
        <p className="text-sm text-sidebar-foreground/60 lg:ml-auto">
          Dados atualizados hoje às{' '}
          {lastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-2xl text-foreground">Dashboard gerencial</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral das perdas registradas pelos funcionários pelo aplicativo.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer data-icon="inline-start" />
            Imprimir
          </Button>
          <Button onClick={exportReport}>
            <Download data-icon="inline-start" />
            Exportar relatório
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </div>
      ) : initialError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="mb-2">{initialError}</p>
          <Button variant="outline" size="sm" onClick={loadDashboardData}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <DashboardHero
            totalFinancialLoss={summary?.currentMonth.totalFinancialLoss ?? 0}
            previousMonthTotal={summary?.previousMonth.totalFinancialLoss ?? 0}
            variationPercent={summary?.financialVariationPercent ?? null}
            trendData={byPeriod}
            projected={summary?.projectedMonthEnd ?? null}
            filters={periodFilters}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Prejuízo de custo no mês"
              value={formatBRL(summary?.currentMonth.totalCostLoss ?? 0)}
              hint="Valor real pago pelos itens perdidos"
            />
            <KpiTile
              label="Itens descartados no mês"
              value={(summary?.currentMonth.totalQuantity ?? 0).toLocaleString('pt-BR')}
              hint={`Mês anterior: ${(summary?.previousMonth.totalQuantity ?? 0).toLocaleString('pt-BR')}`}
            />
            <KpiTile label="Produto mais perdido" value={topProduct} hint="No período filtrado abaixo" />
            <KpiTile label="Motivo mais comum" value={topReason} hint="No período filtrado abaixo" />
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Faturamento do mês e taxa de perda</CardTitle>
          <CardDescription>
            Informe o faturamento do mês corrente para ver a perda como percentual da receita — a métrica
            padrão do varejo (faixa normal: 1–2%).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="space-y-1.5">
            <Label>Faturamento do mês (R$)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="w-48"
              value={revenueInput}
              onChange={(e) => setRevenueInput(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={saveRevenue} disabled={revenueSaving}>
            {revenueSaving ? 'Salvando...' : 'Salvar faturamento'}
          </Button>
          {revenueError && <p className="text-sm text-destructive">{revenueError}</p>}
          <div className="sm:ml-auto">
            <ShrinkageGauge rate={summary?.shrinkageRate ?? null} />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Evolução do prejuízo financeiro</CardTitle>
          </CardHeader>
          <CardContent>
            <LossesTrendChart data={byPeriod} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <CardTitle>Composição das perdas</CardTitle>
            <Tabs value={compositionView} onValueChange={(v) => setCompositionView(v as 'reason' | 'location')}>
              <TabsList>
                <TabsTrigger value="reason">Por motivo</TabsTrigger>
                <TabsTrigger value="location">Por local</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <LossesBreakdownChart byReason={byReason} byLocation={byLocation} view={compositionView} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top ofensores</CardTitle>
            <CardDescription>Produtos que mais impactaram o resultado financeiro</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-3 px-6 pb-4">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar produto..."
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                />
              </div>
              <Badge variant="secondary">{filteredByProduct.length} itens</Badge>
            </div>
            <div className="overflow-x-auto">
              <TopOffendersTable
                data={filteredByProduct}
                total={byProduct.reduce((sum, row) => sum + Number(row.totalFinancialLoss), 0)}
              />
            </div>
          </CardContent>
        </Card>

        <AlertsCard alerts={alerts} />
      </div>

      <SuspiciousPatternsCard entries={suspiciousPatterns} />
    </div>
  );
}

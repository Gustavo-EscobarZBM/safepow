import { Loss } from './loss.entity';
import { lossValue } from './losses-valuation';

export type AlertSeverity = 'critical' | 'warning' | 'success' | 'info';

export interface LossAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
}

export interface MonthSummary {
  currentMonth: { totalQuantity: number; totalFinancialLoss: number };
  previousMonth: { totalQuantity: number; totalFinancialLoss: number };
  financialVariationPercent: number | null;
}

export interface AlertsInput {
  /** Perdas dos últimos 30 dias, com product/reason/location/reportedBy carregados. */
  currentLosses: Loss[];
  /** Perdas dos 30 dias anteriores a isso, para as regras de tendência. */
  previousLosses: Loss[];
  monthSummary: MonthSummary;
  activeEmployeeCount: number;
  /**
   * Top 3 produtos por prejuízo em cada um dos últimos 3 meses de calendário,
   * do mais recente para o mais antigo — usado pela regra de ofensor recorrente.
   */
  recentTop3ByMonth: { id: string; name: string }[][];
  now: Date;
}

/**
 * Limiares fixos das regras (Seção "Alertas e recomendações" do dashboard).
 * Definidos aqui, isolados, para ficar fácil achar e ajustar depois — a ideia
 * inicial foi valores fixos; se algum dia virar configurável por empresa, é
 * aqui que a leitura por company entra.
 */
export const ALERT_THRESHOLDS = {
  monthlyChangePercent: 15,
  reasonShareIncreasePoints: 10,
  concentrationSharePercent: 40,
  reasonLocationComboPercent: 25,
  dailySpikeMultiplier: 3,
  paretoTopFraction: 0.1,
  paretoValueSharePercent: 40,
  paretoMinSample: 5,
  multiLocationMinCount: 3,
  missingPhotoPercent: 70,
  poorDescriptionMinLength: 10,
  poorDescriptionSharePercent: 50,
  dataQualityMinSample: 5,
  lowAdoptionRatioPercent: 50,
  lowAdoptionMinEmployees: 2,
  weekdayConcentrationPercent: 50,
  weekdayMinSample: 5,
  silenceDays: 7,
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, success: 2, info: 3 };

const WEEKDAY_NAMES = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

function pct(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function groupSumByKey(items: Loss[], keyOf: (item: Loss) => string | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    map.set(key, (map.get(key) ?? 0) + lossValue(item));
  }
  return map;
}

function checkMonthlyChange(summary: MonthSummary): LossAlert | null {
  const { financialVariationPercent, previousMonth } = summary;
  if (financialVariationPercent === null || previousMonth.totalFinancialLoss <= 0) return null;

  if (financialVariationPercent >= ALERT_THRESHOLDS.monthlyChangePercent) {
    return {
      id: 'monthly_increase',
      severity: 'critical',
      title: 'Prejuízo mensal em alta',
      description: `O prejuízo deste mês está ${formatPercent(financialVariationPercent)}% acima do mês anterior.`,
    };
  }
  if (financialVariationPercent <= -ALERT_THRESHOLDS.monthlyChangePercent) {
    return {
      id: 'monthly_decrease',
      severity: 'success',
      title: 'Prejuízo mensal em queda',
      description: `O prejuízo deste mês caiu ${formatPercent(Math.abs(financialVariationPercent))}% em relação ao mês anterior. Continue assim.`,
    };
  }
  return null;
}

function checkReasonTrendingUp(current: Loss[], previous: Loss[]): LossAlert | null {
  const currentTotal = current.reduce((s, l) => s + lossValue(l), 0);
  const previousTotal = previous.reduce((s, l) => s + lossValue(l), 0);
  if (currentTotal === 0) return null;

  const currentByReason = groupSumByKey(current, (l) => l.reason?.id ?? null);
  const previousByReason = groupSumByKey(previous, (l) => l.reason?.id ?? null);
  const reasonNames = new Map(current.filter((l) => l.reason).map((l) => [l.reason!.id, l.reason!.name]));

  let best: { name: string; diff: number; currentShare: number; previousShare: number } | null = null;
  for (const [reasonId, amount] of currentByReason) {
    const currentShare = pct(amount, currentTotal);
    const previousShare = pct(previousByReason.get(reasonId) ?? 0, previousTotal);
    const diff = currentShare - previousShare;
    if (diff >= ALERT_THRESHOLDS.reasonShareIncreasePoints && (!best || diff > best.diff)) {
      best = { name: reasonNames.get(reasonId) ?? 'Motivo', diff, currentShare, previousShare };
    }
  }
  if (!best) return null;

  return {
    id: 'reason_trending_up',
    severity: 'warning',
    title: 'Motivo em alta',
    description: `"${best.name}" passou de ${formatPercent(best.previousShare)}% para ${formatPercent(best.currentShare)}% das perdas nas últimas semanas.`,
  };
}

function checkConcentration(
  current: Loss[],
  keyOf: (l: Loss) => { id: string; name: string } | null,
  ruleId: string,
  subjectLabel: string,
): LossAlert | null {
  const total = current.reduce((s, l) => s + lossValue(l), 0);
  if (total === 0) return null;

  const totals = new Map<string, { name: string; amount: number }>();
  for (const loss of current) {
    const key = keyOf(loss);
    if (!key) continue;
    const entry = totals.get(key.id) ?? { name: key.name, amount: 0 };
    entry.amount += lossValue(loss);
    totals.set(key.id, entry);
  }

  let top: { name: string; amount: number } | null = null;
  for (const entry of totals.values()) {
    if (!top || entry.amount > top.amount) top = entry;
  }
  if (!top) return null;

  const share = pct(top.amount, total);
  if (share < ALERT_THRESHOLDS.concentrationSharePercent) return null;

  return {
    id: ruleId,
    severity: 'warning',
    title: `Concentração por ${subjectLabel}`,
    description: `"${top.name}" responde por ${formatPercent(share)}% do prejuízo do período.`,
  };
}

function checkReasonLocationCombo(current: Loss[]): LossAlert | null {
  const total = current.reduce((s, l) => s + lossValue(l), 0);
  if (total === 0) return null;

  const totals = new Map<string, { reasonName: string; locationName: string; amount: number }>();
  for (const loss of current) {
    if (!loss.reason || !loss.location) continue;
    const key = `${loss.reason.id}::${loss.location.id}`;
    const entry = totals.get(key) ?? { reasonName: loss.reason.name, locationName: loss.location.name, amount: 0 };
    entry.amount += lossValue(loss);
    totals.set(key, entry);
  }

  let top: { reasonName: string; locationName: string; amount: number } | null = null;
  for (const entry of totals.values()) {
    if (!top || entry.amount > top.amount) top = entry;
  }
  if (!top) return null;

  const share = pct(top.amount, total);
  if (share < ALERT_THRESHOLDS.reasonLocationComboPercent) return null;

  return {
    id: 'reason_location_combo',
    severity: 'warning',
    title: 'Motivo concentrado em um local',
    description: `"${top.reasonName}" em "${top.locationName}" responde por ${formatPercent(share)}% do prejuízo do período.`,
  };
}

function checkRecurringOffender(recentTop3ByMonth: { id: string; name: string }[][]): LossAlert | null {
  if (recentTop3ByMonth.length < 3) return null;
  const [month0, month1, month2] = recentTop3ByMonth;
  const common = month0.find((p) => month1.some((q) => q.id === p.id) && month2.some((q) => q.id === p.id));
  if (!common) return null;

  return {
    id: 'recurring_offender',
    severity: 'warning',
    title: 'Ofensor recorrente',
    description: `"${common.name}" está entre os 3 produtos com maior prejuízo há 3 meses seguidos.`,
  };
}

function checkReportingSilence(current: Loss[], now: Date): LossAlert | null {
  const cutoff = new Date(now.getTime() - ALERT_THRESHOLDS.silenceDays * 24 * 60 * 60 * 1000);
  const hasRecent = current.some((l) => new Date(l.occurredAt) >= cutoff);
  if (hasRecent) return null;

  return {
    id: 'reporting_silence',
    severity: 'info',
    title: 'Sem registros recentes',
    description: `Nenhuma perda foi registrada nos últimos ${ALERT_THRESHOLDS.silenceDays} dias.`,
  };
}

function checkDailySpike(current: Loss[]): LossAlert | null {
  if (current.length === 0) return null;

  const dailyTotals = new Map<string, number>();
  for (const loss of current) {
    const day = new Date(loss.occurredAt).toISOString().slice(0, 10);
    dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + lossValue(loss));
  }

  const entries = [...dailyTotals.entries()];
  if (entries.length < 2) return null;

  const [peakDay, peakValue] = entries.reduce((max, entry) => (entry[1] > max[1] ? entry : max));
  const rest = entries.filter(([day]) => day !== peakDay);
  const restAverage = rest.reduce((s, [, v]) => s + v, 0) / rest.length;
  if (restAverage <= 0 || peakValue < restAverage * ALERT_THRESHOLDS.dailySpikeMultiplier) return null;

  return {
    id: 'daily_spike',
    severity: 'critical',
    title: 'Pico atípico de prejuízo',
    description: `Em ${new Date(peakDay).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} o prejuízo foi de ${formatBRL(peakValue)}, bem acima da média diária de ${formatBRL(restAverage)} nos demais dias com perdas.`,
  };
}

function checkParetoConcentration(current: Loss[]): LossAlert | null {
  const total = current.reduce((s, l) => s + lossValue(l), 0);
  if (total === 0 || current.length < ALERT_THRESHOLDS.paretoMinSample) return null;

  const sorted = current.map(lossValue).sort((a, b) => b - a);
  const topCount = Math.max(1, Math.round(sorted.length * ALERT_THRESHOLDS.paretoTopFraction));
  const topSum = sorted.slice(0, topCount).reduce((s, v) => s + v, 0);
  const share = pct(topSum, total);
  if (share < ALERT_THRESHOLDS.paretoValueSharePercent) return null;

  return {
    id: 'pareto_concentration',
    severity: 'warning',
    title: 'Poucos registros concentram o prejuízo',
    description: `${topCount} registro(s) (${formatPercent(pct(topCount, sorted.length))}% do total) respondem por ${formatPercent(share)}% do prejuízo do período.`,
  };
}

function checkProductMultiLocation(current: Loss[]): LossAlert | null {
  const byProduct = new Map<string, { name: string; locations: Set<string> }>();
  for (const loss of current) {
    if (!loss.product || !loss.location) continue;
    const entry = byProduct.get(loss.product.id) ?? { name: loss.product.name, locations: new Set<string>() };
    entry.locations.add(loss.location.id);
    byProduct.set(loss.product.id, entry);
  }

  let worst: { name: string; count: number } | null = null;
  for (const entry of byProduct.values()) {
    if (entry.locations.size >= ALERT_THRESHOLDS.multiLocationMinCount && (!worst || entry.locations.size > worst.count)) {
      worst = { name: entry.name, count: entry.locations.size };
    }
  }
  if (!worst) return null;

  return {
    id: 'product_multi_location',
    severity: 'warning',
    title: 'Produto perdido em vários locais',
    description: `"${worst.name}" registrou perdas em ${worst.count} locais diferentes — pode indicar problema de embalagem ou fornecedor.`,
  };
}

function checkMissingPhoto(current: Loss[]): LossAlert | null {
  if (current.length < ALERT_THRESHOLDS.dataQualityMinSample) return null;
  const missing = current.filter((l) => !l.imageUrl).length;
  const share = pct(missing, current.length);
  if (share < ALERT_THRESHOLDS.missingPhotoPercent) return null;

  return {
    id: 'missing_photo',
    severity: 'info',
    title: 'Registros sem foto',
    description: `${formatPercent(share)}% das perdas do período não têm foto anexada — considere reforçar isso com a equipe para facilitar auditorias.`,
  };
}

function checkPoorDescription(current: Loss[]): LossAlert | null {
  if (current.length < ALERT_THRESHOLDS.dataQualityMinSample) return null;
  const poor = current.filter((l) => (l.description ?? '').trim().length < ALERT_THRESHOLDS.poorDescriptionMinLength).length;
  const share = pct(poor, current.length);
  if (share < ALERT_THRESHOLDS.poorDescriptionSharePercent) return null;

  return {
    id: 'poor_description',
    severity: 'info',
    title: 'Descrições pouco detalhadas',
    description: `${formatPercent(share)}% dos registros têm descrições muito curtas — isso dificulta investigar o que aconteceu depois.`,
  };
}

function checkInactiveProductLoss(current: Loss[]): LossAlert | null {
  const inactiveProducts = new Map<string, string>();
  let count = 0;
  for (const loss of current) {
    if (loss.product && loss.product.isActive === false) {
      count += 1;
      inactiveProducts.set(loss.product.id, loss.product.name);
    }
  }
  if (count === 0) return null;

  const names = [...inactiveProducts.values()].slice(0, 3).join(', ');
  return {
    id: 'inactive_product_loss',
    severity: 'info',
    title: 'Perdas em produtos inativos',
    description: `${count} perda(s) registrada(s) em produto(s) já marcados como inativos (${names}) — verifique se o cadastro deveria ter sido atualizado.`,
  };
}

function checkZeroPriceProduct(current: Loss[]): LossAlert | null {
  const zeroPriceProducts = new Map<string, string>();
  for (const loss of current) {
    if (loss.product && Number(loss.unitPriceAtLoss) === 0) {
      zeroPriceProducts.set(loss.product.id, loss.product.name);
    }
  }
  if (zeroPriceProducts.size === 0) return null;

  const names = [...zeroPriceProducts.values()].slice(0, 3).join(', ');
  return {
    id: 'zero_price_product',
    severity: 'warning',
    title: 'Produtos sem preço cadastrado',
    description: `${zeroPriceProducts.size} produto(s) com perdas registradas a preço zero (${names}) estão subestimando o prejuízo real — corrija o preço unitário no cadastro.`,
  };
}

function checkLowAdoption(current: Loss[], activeEmployeeCount: number): LossAlert | null {
  if (activeEmployeeCount < ALERT_THRESHOLDS.lowAdoptionMinEmployees) return null;
  const reporters = new Set(current.map((l) => l.reportedByUserId));
  const ratio = pct(reporters.size, activeEmployeeCount);
  if (ratio >= ALERT_THRESHOLDS.lowAdoptionRatioPercent) return null;

  return {
    id: 'low_adoption',
    severity: 'info',
    title: 'Baixa adoção do app',
    description: `Apenas ${reporters.size} de ${activeEmployeeCount} funcionários ativos registraram alguma perda nas últimas semanas.`,
  };
}

function checkWeekdayConcentration(current: Loss[]): LossAlert | null {
  const byLocation = new Map<string, { name: string; total: number; count: number; byWeekday: number[] }>();
  for (const loss of current) {
    if (!loss.location) continue;
    const entry =
      byLocation.get(loss.location.id) ?? { name: loss.location.name, total: 0, count: 0, byWeekday: new Array(7).fill(0) };
    const weekday = new Date(loss.occurredAt).getDay();
    const value = lossValue(loss);
    entry.total += value;
    entry.count += 1;
    entry.byWeekday[weekday] += value;
    byLocation.set(loss.location.id, entry);
  }

  const candidates: { name: string; weekday: number; share: number }[] = [];
  for (const entry of byLocation.values()) {
    if (entry.count < ALERT_THRESHOLDS.weekdayMinSample || entry.total === 0) continue;
    for (let weekday = 0; weekday < entry.byWeekday.length; weekday += 1) {
      const share = pct(entry.byWeekday[weekday], entry.total);
      if (share >= ALERT_THRESHOLDS.weekdayConcentrationPercent) {
        candidates.push({ name: entry.name, weekday, share });
      }
    }
  }
  if (candidates.length === 0) return null;
  const winner = candidates.reduce((max, candidate) => (candidate.share > max.share ? candidate : max));

  return {
    id: 'weekday_concentration',
    severity: 'info',
    title: 'Padrão de dia da semana',
    description: `${formatPercent(winner.share)}% das perdas em "${winner.name}" acontecem às ${WEEKDAY_NAMES[winner.weekday]}s.`,
  };
}

/**
 * Roda o catálogo fixo de regras do card "Alertas e recomendações" do
 * dashboard e devolve só as que dispararam, ordenadas por severidade
 * (crítico > atenção > boa notícia > informativo).
 */
export function computeLossAlerts(input: AlertsInput): LossAlert[] {
  const checks: (LossAlert | null)[] = [
    checkMonthlyChange(input.monthSummary),
    checkDailySpike(input.currentLosses),
    checkReasonTrendingUp(input.currentLosses, input.previousLosses),
    checkConcentration(input.currentLosses, (l) => (l.product ? { id: l.product.id, name: l.product.name } : null), 'product_concentration', 'produto'),
    checkConcentration(input.currentLosses, (l) => (l.location ? { id: l.location.id, name: l.location.name } : null), 'location_concentration', 'local'),
    checkReasonLocationCombo(input.currentLosses),
    checkRecurringOffender(input.recentTop3ByMonth),
    checkParetoConcentration(input.currentLosses),
    checkProductMultiLocation(input.currentLosses),
    checkZeroPriceProduct(input.currentLosses),
    checkReportingSilence(input.currentLosses, input.now),
    checkMissingPhoto(input.currentLosses),
    checkPoorDescription(input.currentLosses),
    checkInactiveProductLoss(input.currentLosses),
    checkLowAdoption(input.currentLosses, input.activeEmployeeCount),
    checkWeekdayConcentration(input.currentLosses),
  ];

  return checks
    .filter((alert): alert is LossAlert => alert !== null)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

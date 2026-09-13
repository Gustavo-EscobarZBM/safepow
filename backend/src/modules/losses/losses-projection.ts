export interface MonthTotals {
  totalQuantity: number;
  totalFinancialLoss: number;
  totalCostLoss: number;
}

export interface MonthEndProjection extends MonthTotals {
  financialVariationPercent: number | null;
}

/**
 * Projeção de fechamento do mês por extrapolação linear simples: assume que
 * o ritmo de perdas do restante do mês será igual à média diária observada
 * até agora. Não é uma previsão sofisticada — é um alerta cedo o bastante
 * pro gerente agir antes do mês fechar, não uma garantia.
 */
export function projectMonthEnd(
  currentMonth: MonthTotals,
  previousMonth: MonthTotals,
  now: Date,
): MonthEndProjection {
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const factor = daysInMonth / daysElapsed;

  const totalQuantity = currentMonth.totalQuantity * factor;
  const totalFinancialLoss = currentMonth.totalFinancialLoss * factor;
  const totalCostLoss = currentMonth.totalCostLoss * factor;

  const financialVariationPercent =
    previousMonth.totalFinancialLoss === 0
      ? null
      : ((totalFinancialLoss - previousMonth.totalFinancialLoss) / previousMonth.totalFinancialLoss) * 100;

  return { totalQuantity, totalFinancialLoss, totalCostLoss, financialVariationPercent };
}

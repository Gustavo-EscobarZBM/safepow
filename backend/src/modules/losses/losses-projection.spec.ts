import { projectMonthEnd } from './losses-projection';

describe('projectMonthEnd', () => {
  it('extrapola linearmente a partir do dia decorrido do mês', () => {
    // 15 de um mês de 30 dias -> fator 2x
    const now = new Date(2026, 3, 15); // abril/2026 tem 30 dias
    const currentMonth = { totalQuantity: 10, totalFinancialLoss: 100, totalCostLoss: 60 };
    const previousMonth = { totalQuantity: 0, totalFinancialLoss: 0, totalCostLoss: 0 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    expect(result.totalFinancialLoss).toBeCloseTo(200);
    expect(result.totalCostLoss).toBeCloseTo(120);
    expect(result.totalQuantity).toBeCloseTo(20);
  });

  it('calcula a variação percentual projetada vs. mês anterior', () => {
    const now = new Date(2026, 3, 15);
    const currentMonth = { totalQuantity: 10, totalFinancialLoss: 100, totalCostLoss: 60 };
    const previousMonth = { totalQuantity: 10, totalFinancialLoss: 150, totalCostLoss: 90 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    // projetado = 200; (200 - 150) / 150 * 100 = 33.33...
    expect(result.financialVariationPercent).toBeCloseTo(33.33, 1);
  });

  it('retorna variação nula quando não há prejuízo no mês anterior', () => {
    const now = new Date(2026, 3, 15);
    const currentMonth = { totalQuantity: 1, totalFinancialLoss: 50, totalCostLoss: 30 };
    const previousMonth = { totalQuantity: 0, totalFinancialLoss: 0, totalCostLoss: 0 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    expect(result.financialVariationPercent).toBeNull();
  });

  it('no primeiro dia do mês, projeta o dia inteiro sem dividir por zero', () => {
    const now = new Date(2026, 3, 1);
    const currentMonth = { totalQuantity: 1, totalFinancialLoss: 10, totalCostLoss: 6 };
    const previousMonth = { totalQuantity: 0, totalFinancialLoss: 0, totalCostLoss: 0 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    // dia 1 de 30 -> fator 30x
    expect(result.totalFinancialLoss).toBeCloseTo(300);
    expect(Number.isFinite(result.totalFinancialLoss)).toBe(true);
  });
});

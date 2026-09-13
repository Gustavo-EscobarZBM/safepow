import { computeShrinkageRate } from './losses-shrinkage';

describe('computeShrinkageRate', () => {
  it('calcula a taxa como percentual de perda sobre faturamento', () => {
    // 1000 de perda sobre 50000 de faturamento = 2%
    expect(computeShrinkageRate(1000, 50000)).toBeCloseTo(2);
  });

  it('retorna null quando não há faturamento cadastrado (null)', () => {
    expect(computeShrinkageRate(1000, null)).toBeNull();
  });

  it('retorna null quando o faturamento cadastrado é zero', () => {
    expect(computeShrinkageRate(1000, 0)).toBeNull();
  });

  it('retorna 0 quando não há perda no mês', () => {
    expect(computeShrinkageRate(0, 50000)).toBe(0);
  });
});

/**
 * Taxa de perda sobre faturamento (shrinkage rate): a métrica padrão do
 * varejo para saber se o prejuízo é grave dado o tamanho do negócio — perda
 * em valor absoluto sozinha não diz muito sem o faturamento como referência.
 * Usa a perda a preço de venda (mesma base do faturamento), não a de custo.
 * Sem faturamento cadastrado para o mês, não tem como calcular — retorna null
 * em vez de enganar com uma divisão por zero ou um número sem sentido.
 */
export function computeShrinkageRate(financialLoss: number, revenueAmount: number | null): number | null {
  if (!revenueAmount) return null;
  return (financialLoss / revenueAmount) * 100;
}

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LossesBreakdownChart } from './losses-breakdown-chart';

const byReason = [
  { id: '1', label: 'Vencimento', totalQuantity: '10', totalFinancialLoss: '60' },
  { id: '2', label: 'Quebra', totalQuantity: '5', totalFinancialLoss: '40' },
];

describe('LossesBreakdownChart', () => {
  it('shows the empty state when there is no data for the selected view', () => {
    render(<LossesBreakdownChart byReason={[]} byLocation={[]} view="reason" />);
    expect(screen.getByText('Nenhuma perda registrada no período selecionado.')).toBeInTheDocument();
  });

  it('shows the total of the selected breakdown in the center label', () => {
    render(<LossesBreakdownChart byReason={byReason} byLocation={[]} view="reason" />);
    expect(screen.getByTestId('breakdown-total')).toHaveTextContent('100,00');
  });

  it('lists every entry label in the legend', () => {
    render(<LossesBreakdownChart byReason={byReason} byLocation={[]} view="reason" />);
    expect(screen.getByText('Vencimento')).toBeInTheDocument();
    expect(screen.getByText('Quebra')).toBeInTheDocument();
  });
});

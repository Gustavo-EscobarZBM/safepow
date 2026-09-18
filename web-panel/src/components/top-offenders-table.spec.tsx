import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopOffendersTable } from './top-offenders-table';

const rows = [
  { productId: '1', productName: 'Produto A', totalQuantity: '10', totalFinancialLoss: '80', totalCostLoss: '40' },
  { productId: '2', productName: 'Produto B', totalQuantity: '5', totalFinancialLoss: '20', totalCostLoss: '10' },
];

describe('TopOffendersTable', () => {
  it('renders a progress bar sized to each row percent of total', () => {
    render(<TopOffendersTable data={rows} />);
    const bars = screen.getAllByTestId('offender-bar');
    expect(bars[0]).toHaveStyle({ width: '80%' });
    expect(bars[1]).toHaveStyle({ width: '20%' });
  });

  it('shows the empty state when there is no data', () => {
    render(<TopOffendersTable data={[]} />);
    expect(screen.getByText('Nenhuma perda registrada no período selecionado.')).toBeInTheDocument();
  });
});

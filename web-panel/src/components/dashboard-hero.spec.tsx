import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DashboardHero } from './dashboard-hero';

describe('DashboardHero', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the animated total once the count-up finishes', () => {
    vi.useFakeTimers();
    render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[{ totalFinancialLoss: '10' }, { totalFinancialLoss: '20' }]}
        projected={null}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByTestId('hero-value')).toHaveTextContent('1.000,00');
  });

  it('shows the previous month comparison and the variation badge', () => {
    render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
      />,
    );

    expect(screen.getByTestId('hero-comparison')).toHaveTextContent('800,00');
    expect(screen.getByText(/25,0% vs\. mês anterior/)).toBeInTheDocument();
  });

  it('shows the projected month-end line only when there is a positive projection', () => {
    const { rerender } = render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
      />,
    );
    expect(screen.queryByTestId('hero-projected')).not.toBeInTheDocument();

    rerender(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={{ totalFinancialLoss: 1500, financialVariationPercent: 10 }}
      />,
    );
    expect(screen.getByTestId('hero-projected')).toHaveTextContent('1.500,00');
  });

  it('renders the filters slot when provided', () => {
    render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
        filters={<button>Filtrar período</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filtrar período' })).toBeInTheDocument();
  });
});

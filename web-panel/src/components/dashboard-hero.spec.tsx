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

  it('follows the app theme: a light surface by default and the dark brand band only in dark mode', () => {
    const { container } = render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
      />,
    );

    const hero = container.firstElementChild;
    expect(hero).toHaveClass('bg-accent', 'text-foreground', 'dark:bg-sidebar');
    expect(hero).not.toHaveClass('bg-sidebar');
    expect(hero).not.toHaveClass('text-sidebar-foreground');
  });

  it('colors a worsening variation with a red that is legible on both the light and the dark surface', () => {
    render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
      />,
    );

    const badge = screen.getByText(/25,0% vs\. mês anterior/);
    expect(badge).toHaveClass('text-red-700', 'dark:text-red-400');
    expect(badge).not.toHaveClass('text-red-400');
    expect(badge).not.toHaveClass('text-destructive');
  });

  it('colors an improving variation with the success color', () => {
    render(
      <DashboardHero
        totalFinancialLoss={720}
        previousMonthTotal={800}
        variationPercent={-10}
        trendData={[]}
        projected={null}
      />,
    );

    expect(screen.getByText(/10,0% vs\. mês anterior/)).toHaveClass('text-success-foreground');
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

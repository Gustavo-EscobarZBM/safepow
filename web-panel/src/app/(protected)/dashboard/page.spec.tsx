import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './page';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const summary = {
  currentMonth: { totalQuantity: 12, totalFinancialLoss: 1000, totalCostLoss: 500 },
  previousMonth: { totalQuantity: 10, totalFinancialLoss: 800, totalCostLoss: 400 },
  financialVariationPercent: 25,
  costVariationPercent: 25,
  projectedMonthEnd: { totalQuantity: 20, totalFinancialLoss: 1800, totalCostLoss: 900, financialVariationPercent: 10 },
  shrinkageRate: 1.5,
};

function mockHappyPath() {
  (api.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
    if (path.startsWith('losses/reports/summary')) return summary;
    if (path.startsWith('losses/reports/alerts')) return [];
    if (path.startsWith('losses/reports/suspicious-patterns')) return [];
    if (path.startsWith('company-revenue')) return null;
    if (path.startsWith('losses/reports/by-product')) return [];
    if (path.startsWith('losses/reports/by-period')) return [];
    if (path.startsWith('losses/reports/by-reason')) return [];
    if (path.startsWith('losses/reports/by-location')) return [];
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the hero with the loaded monthly total', async () => {
    mockHappyPath();
    render(<DashboardPage />);

    // hero-value renders immediately via DashboardHero's useCountUp animation (real 900ms
    // duration, see use-count-up.ts), starting at 0 and counting up to the target — so we
    // must wait for the animated text to settle rather than just for the node to exist.
    await waitFor(
      () => {
        expect(screen.getByTestId('hero-value')).toHaveTextContent('1.000,00');
      },
      { timeout: 2000 },
    );
  });

  it('still renders the dashboard when only the optional company-revenue request fails', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path.startsWith('losses/reports/summary')) return summary;
      if (path.startsWith('losses/reports/alerts')) return [];
      if (path.startsWith('losses/reports/suspicious-patterns')) return [];
      if (path.startsWith('company-revenue')) throw new Error('Erro de rede.');
      return [];
    });

    render(<DashboardPage />);

    // The revenue figure is an optional, manager-entered field: its failure must not
    // replace the whole dashboard with the retry state.
    const heroValue = await screen.findByTestId('hero-value');
    await waitFor(
      () => {
        expect(heroValue).toHaveTextContent('1.000,00');
      },
      { timeout: 2000 },
    );
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeNull();
  });

  it('draws a strong, always-visible border around the period date fields', async () => {
    mockHappyPath();
    render(<DashboardPage />);

    await screen.findByTestId('hero-value');

    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);
    dateInputs.forEach((input) => {
      // the default `border-input` is almost invisible on the light hero surface
      expect(input).toHaveClass('border-foreground');
    });
  });

  it('shows a retry button when the initial load fails, and recovers on retry', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path.startsWith('losses/reports/summary')) throw new Error('Erro de rede.');
      if (path.startsWith('losses/reports/alerts')) return [];
      if (path.startsWith('losses/reports/suspicious-patterns')) return [];
      if (path.startsWith('company-revenue')) return null;
      return [];
    });

    render(<DashboardPage />);

    const retryButton = await screen.findByRole('button', { name: /tentar novamente/i });

    mockHappyPath();
    await userEvent.click(retryButton);

    // hero-value renders immediately via DashboardHero's useCountUp animation (real 900ms
    // duration, see use-count-up.ts), starting at 0 and counting up to the target — so we
    // must wait for the animated text to settle rather than just for the node to exist.
    await waitFor(
      () => {
        expect(screen.getByTestId('hero-value')).toHaveTextContent('1.000,00');
      },
      { timeout: 2000 },
    );
  });
});

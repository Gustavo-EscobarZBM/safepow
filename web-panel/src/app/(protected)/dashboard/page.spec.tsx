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

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConferenciasClient } from './conferencias-client';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const pendingLoss = {
  id: 'loss-1',
  quantity: 3,
  occurredAt: '2026-09-18T12:00:00.000Z',
  product: { name: 'Arroz 5kg' },
  reportedBy: { name: 'Maria' },
};

function mockApi() {
  (api.get as Mock).mockImplementation(async (path: string) => {
    if (path === 'companies/me/settings') return { lossVerificationEnabled: true, lossVerifierId: null };
    if (path === 'users') return [];
    if (path === 'losses/pending-verification') return [pendingLoss];
    throw new Error(`unexpected path: ${path}`);
  });
  (api.patch as Mock).mockResolvedValue({});
}

describe('ConferenciasClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('lets a manager configure the verification and see the pending list', async () => {
    render(<ConferenciasClient canConfigure />);

    expect(await screen.findByText('Arroz 5kg')).toBeInTheDocument();
    expect(screen.getByText('Configuração')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('companies/me/settings');
    expect(api.get).toHaveBeenCalledWith('users');
    expect(api.get).toHaveBeenCalledWith('losses/pending-verification');
  });

  it('shows the designated verifier only the pending list, without calling manager-only endpoints', async () => {
    render(<ConferenciasClient canConfigure={false} />);

    expect(await screen.findByText('Arroz 5kg')).toBeInTheDocument();
    expect(screen.getByText('Pendências')).toBeInTheDocument();
    expect(screen.queryByText('Configuração')).not.toBeInTheDocument();
    expect(screen.queryByText(/ativar conferência de descarte/i)).not.toBeInTheDocument();
    // settings and users are manager-only in the backend (403 for the verifier)
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('losses/pending-verification');
  });

  it('lets the verifier confirm a pending loss', async () => {
    render(<ConferenciasClient canConfigure={false} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    expect(api.patch).toHaveBeenCalledWith('losses/loss-1/verify');
    await waitFor(() => expect(screen.queryByText('Arroz 5kg')).not.toBeInTheDocument());
    expect(screen.getByText(/nenhuma pendência no momento/i)).toBeInTheDocument();
  });
});

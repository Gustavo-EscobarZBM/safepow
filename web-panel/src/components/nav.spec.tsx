import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Nav } from './nav';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('Nav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockResolvedValue({ count: 0 });
  });

  it('shows the official brand logo at the top of the sidebar', () => {
    render(<Nav user={{ id: '1', name: 'Ana', role: 'manager', companyId: 'c1' }} />);
    expect(screen.getByRole('img', { name: /safepow.*prevenção/i })).toBeInTheDocument();
  });

  it('marks the active manager link with aria-current="page"', () => {
    render(<Nav user={{ id: '1', name: 'Ana', role: 'manager', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /perdas/i })).not.toHaveAttribute('aria-current');
  });

  it('shows only the employee link for the employee role', () => {
    render(<Nav user={{ id: '2', name: 'João', role: 'employee', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /perdas/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /conferências/i })).not.toBeInTheDocument();
  });

  it('adds the confirmations link for the employee designated as verifier', () => {
    render(<Nav user={{ id: '3', name: 'Conferente', role: 'employee', companyId: 'c1', isLossVerifier: true }} />);
    expect(screen.getByRole('link', { name: /conferências/i })).toHaveAttribute('href', '/conferencias');
    expect(screen.getByRole('link', { name: /perdas/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });
  it('mostra "Auditoria" para o gerente e não para o funcionário', () => {
    const { unmount } = render(<Nav user={{ id: '1', name: 'Ana', role: 'manager', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /Auditoria/ })).toHaveAttribute('href', '/auditoria');
    unmount();
    render(<Nav user={{ id: '2', name: 'João', role: 'employee', companyId: 'c1' }} />);
    expect(screen.queryByRole('link', { name: /Auditoria/ })).not.toBeInTheDocument();
  });

  const manager = { id: '1', name: 'Ana', role: 'manager' as const, companyId: 'c1' };

  it('gerente vê "Aprovações" com o selo de pendentes', async () => {
    (api.get as Mock).mockResolvedValue({ count: 3 });
    render(<Nav user={manager} />);

    expect(screen.getByRole('link', { name: /Aprovações/ })).toHaveAttribute('href', '/aprovacoes');
    expect(await screen.findByLabelText('3 pedidos pendentes')).toHaveTextContent('3');
    expect(api.get).toHaveBeenCalledWith('change-requests/pending-count');
  });

  it('sem pendentes não há selo; funcionário nem busca a contagem', async () => {
    const { unmount } = render(<Nav user={manager} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByLabelText(/pedidos pendentes/)).not.toBeInTheDocument();
    unmount();
    vi.clearAllMocks();

    render(<Nav user={{ id: '2', name: 'João', role: 'employee', companyId: 'c1' }} />);
    expect(screen.queryByRole('link', { name: /Aprovações/ })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('o evento approvals:changed atualiza o selo', async () => {
    (api.get as Mock).mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    render(<Nav user={manager} />);
    expect(await screen.findByLabelText('2 pedidos pendentes')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('approvals:changed'));
    });

    expect(await screen.findByLabelText('1 pedidos pendentes')).toBeInTheDocument();
  });

  it('falha ao buscar a contagem não quebra o menu', async () => {
    (api.get as Mock).mockRejectedValue(new Error('rede'));
    render(<Nav user={manager} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /Aprovações/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/pedidos pendentes/)).not.toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AprovacoesClient } from './aprovacoes-client';
import { api, ApiError } from '@/lib/api-client';
import type { ApprovalPoliciesState, ChangeRequest } from '@/lib/types';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));

const ME = 'u-me';

const POLICIES: ApprovalPoliciesState = {
  policies: {
    price_change: { enabled: true, thresholdPercent: 20 },
    retro_fix: { enabled: false },
    loss_edit: { enabled: true },
    archive_with_history: { enabled: false },
  },
  activeManagers: 2,
  mode: 'approval',
};

function request(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'c1',
    policy: 'price_change',
    entityType: 'product',
    entityId: 'p1',
    entityLabel: 'Arroz',
    operation: 'update',
    payload: { unitPrice: 15 },
    snapshot: { unitPrice: '10.00' },
    justification: 'Fornecedor reajustou',
    status: 'pending',
    requestedByUserId: 'u-ana',
    requestedByName: 'Ana',
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    decisionNote: null,
    expiresAt: '2026-10-02T12:00:00.000Z',
    createdAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  };
}

function mockGet(pending: ChangeRequest[], decided: ChangeRequest[] = []) {
  (api.get as Mock).mockImplementation(async (path: string) => {
    if (path === 'approval-policies') return POLICIES;
    if (path === 'change-requests?status=pending') return pending;
    if (path === 'change-requests?status=decided') return decided;
    throw new Error(`unexpected path: ${path}`);
  });
}

const requestsList = () => screen.findByRole('list', { name: 'Pedidos' });

describe('AprovacoesClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra o modo atual e as políticas conforme a API', async () => {
    mockGet([]);
    render(<AprovacoesClient currentUserId={ME} />);

    expect(
      await screen.findByText('Sua empresa tem 2 gerentes ativos: as mudanças sensíveis vão para aprovação de outro gerente.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mudança de preço ou custo acima de X%' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Correção retroativa de preço' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Editar ou excluir perda registrada' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Arquivar produto que já tem perdas' })).not.toBeChecked();
  });

  it('salvar políticas envia as 4, com o limite editado', async () => {
    mockGet([]);
    (api.put as Mock).mockResolvedValue(POLICIES);
    render(<AprovacoesClient currentUserId={ME} />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Editar ou excluir perda registrada' }));
    const threshold = screen.getByLabelText('Limite (%)');
    await userEvent.clear(threshold);
    await userEvent.type(threshold, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar políticas' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('approval-policies', {
        price_change: { enabled: true, thresholdPercent: 30 },
        retro_fix: { enabled: false },
        loss_edit: { enabled: false },
        archive_with_history: { enabled: false },
      }),
    );
    expect(await screen.findByText('Políticas salvas.')).toBeInTheDocument();
  });

  it('pedido de outro gerente: mostra o "de → para" e aprova com observação', async () => {
    mockGet([request()]);
    (api.post as Mock).mockResolvedValue(request({ status: 'approved' }));
    render(<AprovacoesClient currentUserId={ME} />);

    const list = await requestsList();
    expect(list).toHaveTextContent('Arroz');
    expect(list).toHaveTextContent(/Preço unitário: R\$\s?10,00 → R\$\s?15,00/);
    expect(list).toHaveTextContent('Pedido por Ana');
    expect(list).toHaveTextContent('Justificativa: Fornecedor reajustou');

    await userEvent.type(within(list).getByLabelText('Observação (opcional)'), 'Conferi');
    const before = (api.get as Mock).mock.calls.length;
    await userEvent.click(within(list).getByRole('button', { name: 'Aprovar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('change-requests/c1/approve', { note: 'Conferi' }));
    await waitFor(() => expect((api.get as Mock).mock.calls.length).toBeGreaterThan(before));
  });

  it('recusar envia para /reject', async () => {
    mockGet([request()]);
    (api.post as Mock).mockResolvedValue(request({ status: 'rejected' }));
    render(<AprovacoesClient currentUserId={ME} />);

    await userEvent.click(within(await requestsList()).getByRole('button', { name: 'Recusar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('change-requests/c1/reject', { note: undefined }));
  });

  it('pedido do próprio gerente: só "Cancelar pedido"', async () => {
    mockGet([request({ requestedByUserId: ME })]);
    (api.post as Mock).mockResolvedValue(request({ status: 'cancelled' }));
    render(<AprovacoesClient currentUserId={ME} />);

    const list = await requestsList();
    expect(within(list).queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Recusar' })).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Cancelar pedido' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('change-requests/c1/cancel'));
  });

  it('registro mudou desde o pedido: mostra a nota do pedido expirado', async () => {
    mockGet([request()]);
    (api.post as Mock).mockResolvedValue(request({ status: 'expired', decisionNote: 'O registro mudou desde o pedido.' }));
    render(<AprovacoesClient currentUserId={ME} />);

    await userEvent.click(within(await requestsList()).getByRole('button', { name: 'Aprovar' }));

    expect(await screen.findByText('O registro mudou desde o pedido.')).toBeInTheDocument();
  });

  it('erro da API ao decidir aparece na tela', async () => {
    mockGet([request()]);
    (api.post as Mock).mockRejectedValue(new ApiError(403, 'Quem pediu a mudança não pode aprová-la nem recusá-la.'));
    render(<AprovacoesClient currentUserId={ME} />);

    await userEvent.click(within(await requestsList()).getByRole('button', { name: 'Aprovar' }));

    expect(await screen.findByText('Quem pediu a mudança não pode aprová-la nem recusá-la.')).toBeInTheDocument();
  });

  it('aba Decididos lista o status e a nota', async () => {
    mockGet([], [request({ status: 'rejected', decidedByName: 'Bruno', decisionNote: 'Fora da tabela' })]);
    render(<AprovacoesClient currentUserId={ME} />);

    await userEvent.click(await screen.findByRole('tab', { name: 'Decididos' }));

    const list = await requestsList();
    await waitFor(() => expect(list).toHaveTextContent('Recusado'));
    expect(list).toHaveTextContent('por Bruno');
    expect(list).toHaveTextContent('Fora da tabela');
    expect(api.get).toHaveBeenCalledWith('change-requests?status=decided');
  });

  it('avisa o menu (evento approvals:changed) depois de decidir', async () => {
    mockGet([request()]);
    (api.post as Mock).mockResolvedValue(request({ status: 'approved' }));
    const listener = vi.fn();
    window.addEventListener('approvals:changed', listener);
    render(<AprovacoesClient currentUserId={ME} />);

    await userEvent.click(within(await requestsList()).getByRole('button', { name: 'Aprovar' }));

    await waitFor(() => expect(listener).toHaveBeenCalled());
    window.removeEventListener('approvals:changed', listener);
  });
  it('troca rápida de abas: resposta atrasada da outra aba é descartada', async () => {
    let resolveDecided: (value: unknown) => void = () => {};
    (api.get as Mock).mockImplementation((path: string) => {
      if (path === 'approval-policies') return Promise.resolve(POLICIES);
      if (path === 'change-requests?status=pending') return Promise.resolve([request({ entityLabel: 'Pedido pendente' })]);
      if (path === 'change-requests?status=decided') return new Promise((resolve) => (resolveDecided = resolve));
      return Promise.reject(new Error(path));
    });
    render(<AprovacoesClient currentUserId={ME} />);
    await screen.findByText('Pedido pendente');

    await userEvent.click(screen.getByRole('tab', { name: 'Decididos' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Pendentes' }));
    await screen.findByText('Pedido pendente');
    resolveDecided([request({ id: 'd1', status: 'rejected', entityLabel: 'Pedido decidido' })]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Pedido decidido')).not.toBeInTheDocument();
    expect(screen.getByText('Pedido pendente')).toBeInTheDocument();
  });

  it('erro ao carregar a outra aba não deixa na tela a lista anterior', async () => {
    (api.get as Mock).mockImplementation((path: string) => {
      if (path === 'approval-policies') return Promise.resolve(POLICIES);
      if (path === 'change-requests?status=pending') return Promise.resolve([request({ entityLabel: 'Pedido pendente' })]);
      return Promise.reject(new ApiError(500, 'Falha ao listar.'));
    });
    render(<AprovacoesClient currentUserId={ME} />);
    await screen.findByText('Pedido pendente');

    await userEvent.click(screen.getByRole('tab', { name: 'Decididos' }));

    expect(await screen.findByText('Falha ao listar.')).toBeInTheDocument();
    expect(screen.queryByText('Pedido pendente')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
  });
});

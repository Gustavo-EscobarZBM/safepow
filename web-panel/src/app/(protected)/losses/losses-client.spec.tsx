import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LossesClient } from './losses-client';
import { api, ApiError } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), getBlob: vi.fn(), postForm: vi.fn() },
}));

const loss = {
  id: 'l-1',
  productId: 'p-1',
  product: { name: 'Arroz 5kg' },
  quantity: '2',
  reason: { name: 'Quebra/Avaria' },
  location: { name: 'Depósito/Estoque' },
  description: null,
  reportedBy: { name: 'João' },
  imageUrl: null,
  occurredAt: '2026-09-24T12:00:00.000Z',
};

describe('LossesClient — gaveta Histórico', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gerente abre o histórico da perda pela linha', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      if (path.startsWith('losses')) return [loss];
      return []; // products, loss-reasons, loss-locations: arrays
    });

    render(<LossesClient role="manager" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico da perda' }));

    expect(api.get).toHaveBeenCalledWith('audit?entityType=loss&entityId=l-1&pageSize=100');
  });
});

function justificationRequired(mode: 'approval' | 'justification') {
  return new ApiError(409, mode === 'approval' ? 'Precisa de aprovação de outro gerente.' : 'Esta mudança exige uma justificativa.', {
    errorCode: 'JUSTIFICATION_REQUIRED',
    policy: 'price_change',
    mode,
  });
}

describe('LossesClient — justificativa e aprovação (SP2, 2.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('losses')) return [loss];
      return [];
    });
  });

  const lossListCalls = () => (api.get as Mock).mock.calls.filter((call) => (call[0] as string).startsWith('losses')).length;

  it('editar perda em modo aprovação mostra o aviso e fecha a edição', async () => {
    (api.patch as Mock)
      .mockRejectedValueOnce(justificationRequired('approval'))
      .mockResolvedValueOnce({ status: 'pending', changeRequestId: 'c1', policy: 'loss_edit' });
    render(<LossesClient role="manager" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar perda' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Salvar alterações' }));

    await userEvent.type(await screen.findByLabelText('Justificativa'), 'Quantidade lançada errada');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação' }));

    expect(await screen.findByText('Enviado para aprovação de outro gerente.')).toBeInTheDocument();
    expect((api.patch as Mock).mock.calls[1][1]).toMatchObject({ justification: 'Quantidade lançada errada' });
    await waitFor(() => expect(screen.queryByText('Editar perda', { selector: 'h2' })).not.toBeInTheDocument());
  });

  it('excluir perda com justificativa reenvia no corpo e recarrega a lista', async () => {
    (api.delete as Mock).mockRejectedValueOnce(justificationRequired('justification')).mockResolvedValueOnce(undefined);
    render(<LossesClient role="manager" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir perda' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir definitivamente' }));

    await userEvent.type(await screen.findByLabelText('Justificativa'), 'Registro duplicado no app');
    const before = lossListCalls();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(api.delete).toHaveBeenLastCalledWith('losses/l-1', { justification: 'Registro duplicado no app' }));
    await waitFor(() => expect(lossListCalls()).toBeGreaterThan(before));
  });
});

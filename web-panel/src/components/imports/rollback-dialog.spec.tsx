import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RollbackDialog } from './rollback-dialog';
import { api, ApiError } from '@/lib/api-client';
import type { ImportJob, RollbackPreview } from '@/lib/imports';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const JOB = { id: 'j1', status: 'completed', fileName: 'produtos.xlsx' } as ImportJob;

function preview(overrides: Partial<RollbackPreview> = {}): RollbackPreview {
  return { restore: 3, conflicts: 0, items: [], total: 0, expiresAt: '2026-10-20T12:00:00Z', ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderDialog() {
  const onStarted = vi.fn();
  const onOpenChange = vi.fn();
  render(<RollbackDialog job={JOB} open onOpenChange={onOpenChange} onStarted={onStarted} />);
  return { onStarted, onOpenChange };
}

describe('RollbackDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sem conflitos: diz quantas alterações voltam', async () => {
    (api.get as Mock).mockResolvedValue(preview());
    renderDialog();
    expect(await screen.findByText('3 alterações serão desfeitas.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('imports/j1/rollback-preview?page=1&limit=20');
    expect(screen.queryByText(/mudaram depois da importação/)).not.toBeInTheDocument();
  });

  it('com conflitos: lista os produtos que ficam como estão', async () => {
    (api.get as Mock).mockResolvedValue(
      preview({
        restore: 2,
        conflicts: 2,
        total: 2,
        items: [
          { key: '100', name: 'Arroz', appliedAction: 'update', reason: 'changed' },
          { key: '200', name: 'Feijão', appliedAction: 'create', reason: 'deleted' },
        ],
      }),
    );
    renderDialog();
    expect(await screen.findByText('2 produtos mudaram depois da importação e ficam como estão.')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Arroz')).toBeInTheDocument();
    expect(within(table).getByText('Alterado depois')).toBeInTheDocument();
    expect(within(table).getByText('Excluído')).toBeInTheDocument();
  });

  it('paginação dos conflitos descarta a resposta atrasada da página anterior', async () => {
    const slowFirst = deferred<RollbackPreview>();
    const conflict = (name: string) => ({ key: `K-${name.length}`, name, appliedAction: 'update' as const, reason: 'changed' as const });
    let calls = 0;
    (api.get as Mock).mockImplementation((path: string) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(preview({ conflicts: 45, total: 45, items: [conflict('Produto primeira')] }));
      if (path.includes('page=2')) return Promise.resolve(preview({ conflicts: 45, total: 45, items: [conflict('Produto segunda')] }));
      return slowFirst.promise;
    });
    renderDialog();
    expect(await screen.findByText('Produto primeira')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Produto segunda')).toBeInTheDocument();
    await act(async () => slowFirst.resolve(preview({ conflicts: 45, total: 45, items: [conflict('Atrasada')] })));
    expect(screen.queryByText('Atrasada')).not.toBeInTheDocument();
  });

  it('reverter chama a API e avisa quem chamou', async () => {
    (api.get as Mock).mockResolvedValue(preview());
    const rolling = { ...JOB, status: 'rolling_back' };
    (api.post as Mock).mockResolvedValue({ job: rolling });
    const { onStarted } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Reverter importação' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(rolling, false));
    expect(api.post).toHaveBeenCalledWith('imports/j1/rollback', {});
  });

  it('política pede justificativa: diálogo e reenvio com o texto', async () => {
    (api.get as Mock).mockResolvedValue(preview());
    const rolling = { ...JOB, status: 'rolling_back' };
    (api.post as Mock)
      .mockRejectedValueOnce(
        new ApiError(409, 'O preço volta além do limite.', { errorCode: 'JUSTIFICATION_REQUIRED', policy: 'price_change', mode: 'justification' }),
      )
      .mockResolvedValueOnce({ job: rolling });
    const { onStarted } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Reverter importação' }));
    await userEvent.type(await screen.findByLabelText('Justificativa'), 'Planilha errada');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(rolling, false));
    expect((api.post as Mock).mock.calls[1][1]).toEqual({ justification: 'Planilha errada' });
  });

  it('pedido de aprovação: avisa com pending=true', async () => {
    (api.get as Mock).mockResolvedValue(preview());
    (api.post as Mock).mockResolvedValue({ status: 'pending', changeRequestId: 'c1', job: JOB });
    const { onStarted } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Reverter importação' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(JOB, true));
  });

  it('prazo vencido: mostra a mensagem e não fica girando', async () => {
    (api.get as Mock).mockResolvedValue(preview());
    (api.post as Mock).mockRejectedValue(
      new ApiError(409, 'Esta importação tem mais de 30 dias e não pode mais ser revertida.', { errorCode: 'ROLLBACK_EXPIRED' }),
    );
    const { onStarted } = renderDialog();
    const button = await screen.findByRole('button', { name: 'Reverter importação' });
    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('mais de 30 dias');
    expect(button).toBeEnabled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('erro na prévia aparece e não libera o botão', async () => {
    (api.get as Mock).mockRejectedValue(new ApiError(409, 'Esta importação tem mais de 30 dias e não pode mais ser revertida.'));
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent('mais de 30 dias');
    expect(screen.getByRole('button', { name: 'Reverter importação' })).toBeDisabled();
  });
});

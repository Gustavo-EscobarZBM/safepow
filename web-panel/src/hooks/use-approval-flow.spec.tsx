import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/api-client';
import { useApprovalFlow } from './use-approval-flow';

const PENDING = { status: 'pending', changeRequestId: 'c1', policy: 'loss_edit' };

function required(mode: 'approval' | 'justification', message = 'Precisa de aprovação') {
  return new ApiError(409, message, { errorCode: 'JUSTIFICATION_REQUIRED', policy: 'price_change', mode });
}

function Harness({ action, onDone }: { action: (j?: string) => Promise<unknown>; onDone: (o: string) => void }) {
  const approval = useApprovalFlow();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        onClick={() => {
          setError(null);
          approval.execute(action, onDone).catch((e: Error) => setError(e.message));
        }}
      >
        Salvar
      </button>
      {approval.notice && <p role="status">{approval.notice}</p>}
      {error && <p>erro: {error}</p>}
      {approval.dialog}
    </div>
  );
}

describe('useApprovalFlow', () => {
  it('ação aplicada direto ⇒ onDone("applied"), sem diálogo nem aviso', async () => {
    const action = vi.fn().mockResolvedValue({ id: 'p1' });
    const onDone = vi.fn();
    render(<Harness action={action} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('applied'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('resposta pendente ⇒ onDone("pending") e o aviso', async () => {
    const onDone = vi.fn();
    render(<Harness action={vi.fn().mockResolvedValue(PENDING)} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pending'));
    expect(screen.getByRole('status')).toHaveTextContent('Enviado para aprovação de outro gerente.');
  });

  it('409 ⇒ pede justificativa (mín. 10 caracteres úteis) e reenvia', async () => {
    const action = vi.fn().mockRejectedValueOnce(required('approval')).mockResolvedValueOnce(PENDING);
    const onDone = vi.fn();
    render(<Harness action={action} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Precisa de aprovação');
    const send = screen.getByRole('button', { name: 'Enviar para aprovação' });
    const textarea = screen.getByLabelText('Justificativa');

    await userEvent.type(textarea, 'curta');
    expect(send).toBeDisabled();
    await userEvent.clear(textarea);
    await userEvent.type(textarea, '            ');
    expect(send).toBeDisabled();
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Fornecedor reajustou');
    expect(send).toBeEnabled();
    await userEvent.click(send);

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pending'));
    expect(action).toHaveBeenNthCalledWith(2, 'Fornecedor reajustou');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('modo justificativa ⇒ botão "Confirmar"', async () => {
    render(<Harness action={vi.fn().mockRejectedValueOnce(required('justification'))} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
  });

  it('erro no reenvio aparece no diálogo, que continua aberto com o texto', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(required('justification'))
      .mockRejectedValueOnce(new ApiError(400, 'A justificativa precisa ter pelo menos 10 caracteres.'));
    const onDone = vi.fn();
    render(<Harness action={action} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await userEvent.type(await screen.findByLabelText('Justificativa'), 'Motivo qualquer');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('A justificativa precisa ter pelo menos 10 caracteres.')).toBeInTheDocument();
    expect(screen.getByLabelText('Justificativa')).toHaveValue('Motivo qualquer');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('cancelar fecha sem reenviar', async () => {
    const action = vi.fn().mockRejectedValueOnce(required('approval'));
    const onDone = vi.fn();
    render(<Harness action={action} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(action).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('outros erros voltam para quem chamou, sem diálogo', async () => {
    const action = vi.fn().mockRejectedValue(new ApiError(409, 'Código já usado', { errorCode: 'PRODUCT_BARCODE_TAKEN' }));
    render(<Harness action={action} onDone={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('erro: Código já usado')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

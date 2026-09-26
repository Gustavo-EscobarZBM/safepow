import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/api-client';
import { ResourceFormDialog } from './resource-form-dialog';

const FIELDS = [{ name: 'name', label: 'Motivo', required: true }];

function setup(overrides: Partial<Parameters<typeof ResourceFormDialog>[0]> = {}) {
  const props = {
    open: true,
    title: 'Editar motivo',
    description: 'Altere o nome e salve.',
    fields: FIELDS,
    initialValues: { name: 'Quebra' },
    errorFallback: 'Erro ao salvar motivo.',
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onOpenChange: vi.fn(),
    ...overrides,
  };
  const view = render(<ResourceFormDialog {...props} />);
  return { props, view };
}

describe('ResourceFormDialog', () => {
  it('abre com os valores iniciais e salva', async () => {
    const { props } = setup();
    const field = screen.getByLabelText('Motivo');
    expect(field).toHaveValue('Quebra');
    await userEvent.clear(field);
    await userEvent.type(field, 'Novo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ name: 'Novo' }));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('clique duplo envia uma vez só', async () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    setup({ onSubmit });
    await userEvent.dblClick(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled();
  });

  it('erro da API fica no diálogo, que continua aberto', async () => {
    const { props } = setup({ onSubmit: vi.fn().mockRejectedValue(new ApiError(409, 'Já existe.')) });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Já existe.')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('erro genérico usa o texto padrão', async () => {
    setup({ onSubmit: vi.fn().mockRejectedValue(new Error('rede')) });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Erro ao salvar motivo.')).toBeInTheDocument();
  });

  it('campo obrigatório vazio não envia', async () => {
    const { props } = setup();
    await userEvent.clear(screen.getByLabelText('Motivo'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('reabrir com outros valores mostra os novos', () => {
    const { props, view } = setup();
    view.rerender(<ResourceFormDialog {...props} open={false} />);
    view.rerender(<ResourceFormDialog {...props} open initialValues={{ name: 'Furto' }} />);
    expect(screen.getByLabelText('Motivo')).toHaveValue('Furto');
  });

  it('Cancelar fecha', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

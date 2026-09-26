import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArchiveDialog } from './archive-dialog';

function setup(confirming = false) {
  const props = {
    open: true,
    title: 'Arquivar produto',
    description: (
      <>
        <strong>Arroz</strong> deixará de aparecer no app.
      </>
    ),
    confirming,
    onConfirm: vi.fn(),
    onOpenChange: vi.fn(),
  };
  render(<ArchiveDialog {...props} />);
  return props;
}

describe('ArchiveDialog', () => {
  it('mostra título e descrição; Arquivar confirma; Cancelar fecha', async () => {
    const props = setup();
    expect(screen.getByRole('heading', { name: 'Arquivar produto' })).toBeInTheDocument();
    expect(screen.getByText('Arroz')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    expect(props.onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('enquanto confirma: "Arquivando..." e botões desabilitados', () => {
    setup(true);
    expect(screen.getByRole('button', { name: 'Arquivando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  });
});

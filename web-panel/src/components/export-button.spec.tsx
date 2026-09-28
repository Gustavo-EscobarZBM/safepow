import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportButton } from './export-button';
import { api, ApiError } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { getBlob: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('ExportButton', () => {
  let click: ReturnType<typeof vi.spyOn>;
  let downloads: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    downloads = [];
    Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });
  afterEach(() => click.mockRestore());

  it('menu com Excel e CSV; parâmetro vazio é omitido; baixa com a data de hoje', async () => {
    (api.getBlob as Mock).mockResolvedValue(new Blob(['x']));
    render(<ExportButton path="products/export" fileBase="produtos" params={{ status: 'archived', q: undefined }} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(screen.getByRole('menuitem', { name: 'CSV (.csv)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));

    await waitFor(() => expect(api.getBlob).toHaveBeenCalledWith('products/export?format=xlsx&status=archived'));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toMatch(/^produtos-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('mostra "Gerando…" enquanto baixa', async () => {
    const pending = deferred<Blob>();
    (api.getBlob as Mock).mockReturnValue(pending.promise);
    render(<ExportButton path="users/export" fileBase="usuarios" />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));
    expect(screen.getByRole('button', { name: 'Gerando…' })).toBeDisabled();
    expect(api.getBlob).toHaveBeenCalledWith('users/export?format=csv');
    pending.resolve(new Blob(['x']));
    expect(await screen.findByRole('button', { name: 'Exportar' })).toBeEnabled();
  });

  it('erro do backend aparece e o botão volta', async () => {
    (api.getBlob as Mock).mockRejectedValue(new ApiError(400, 'A exportação passa de 200.000 linhas. Filtre antes de exportar.'));
    render(<ExportButton path="products/export" fileBase="produtos" />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A exportação passa de 200.000 linhas.');
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeEnabled();
    expect(downloads).toHaveLength(0);
  });

  it('Esc fecha o menu', async () => {
    render(<ExportButton path="products/export" fileBase="produtos" />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

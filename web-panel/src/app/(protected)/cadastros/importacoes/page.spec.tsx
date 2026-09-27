import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportsHistoryPage from './page';
import { api } from '@/lib/api-client';
import type { ImportListItem, ImportSummary } from '@/lib/imports';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn() },
}));

const SUMMARY: ImportSummary = {
  totalRows: 10,
  counts: { create: 3, update: 4, reactivate: 0, unchanged: 2, error: 1, duplicate: 0, archive: 0 },
  warnings: {},
  missingCount: 0,
  sensitive: { priceChange: 0, archiveWithHistory: 0 },
};

function item(overrides: Partial<ImportListItem> = {}): ImportListItem {
  return {
    id: 'j1',
    status: 'completed',
    fileName: 'produtos.xlsx',
    createdAt: '2026-09-27T13:00:00Z',
    createdByName: 'Gerente Um',
    totalRows: 10,
    summary: SUMMARY,
    ...overrides,
  } as ImportListItem;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('Histórico de importações', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista as importações com situação, resultado e link para abrir', async () => {
    (api.get as Mock).mockResolvedValue({ items: [item(), item({ id: 'j2', status: 'pending_approval', summary: null, fileName: 'b.csv' })], total: 2 });
    render(<ImportsHistoryPage />);
    expect(await screen.findByText('produtos.xlsx')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('imports?resource=products&page=1&limit=20');
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.getByText('Aguardando aprovação')).toBeInTheDocument();
    expect(screen.getAllByText('Gerente Um', { selector: 'td' })).toHaveLength(2);
    expect(screen.getByText('3 criados · 4 atualizados · 1 erro')).toBeInTheDocument();
    const open = screen.getAllByRole('link', { name: /Abrir/ });
    expect(open[1]).toHaveAttribute('href', '/cadastros/importacoes/j2');
    expect(screen.getByRole('link', { name: 'Nova importação' })).toHaveAttribute('href', '/cadastros/importacoes/nova');
  });

  it('sem importações mostra o estado vazio', async () => {
    (api.get as Mock).mockResolvedValue({ items: [], total: 0 });
    render(<ImportsHistoryPage />);
    expect(await screen.findByText('Nenhuma importação ainda.')).toBeInTheDocument();
  });

  it('pagina e descarta a resposta atrasada da página anterior', async () => {
    const first = deferred<{ items: ImportListItem[]; total: number }>();
    let calls = 0;
    (api.get as Mock).mockImplementation((path: string) => {
      calls++;
      if (calls === 1) return Promise.resolve({ items: [item({ fileName: 'pagina1.xlsx' })], total: 45 });
      if (path.includes('page=2')) return Promise.resolve({ items: [item({ id: 'j9', fileName: 'pagina2.xlsx' })], total: 45 });
      return first.promise;
    });
    render(<ImportsHistoryPage />);
    expect(await screen.findByText('pagina1.xlsx')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('pagina2.xlsx')).toBeInTheDocument();
    await act(async () => first.resolve({ items: [item({ fileName: 'atrasada.xlsx' })], total: 45 }));
    await waitFor(() => expect(screen.queryByText('atrasada.xlsx')).not.toBeInTheDocument());
    expect(screen.getByText('pagina2.xlsx')).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuditPage from './page';
import { api, ApiError } from '@/lib/api-client';
import type { AuditLogEntry } from '@/lib/types';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), getBlob: vi.fn() },
}));

function item(id: string, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    createdAt: '2026-09-24T12:00:00.000Z',
    actorUserId: 'u1',
    actorName: 'Ana Gerente',
    actorRole: 'manager',
    entityType: 'product',
    entityId: 'p1',
    entityLabel: 'Arroz 5kg',
    action: 'update',
    changes: [{ field: 'unitPrice', from: 10, to: 12 }],
    summary: null,
    source: 'web',
    reason: null,
    requestId: null,
    ip: null,
    ...overrides,
  };
}

describe('AuditPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista com pessoa, origem, ação, entidade legível e alterações', async () => {
    (api.get as Mock).mockResolvedValue({
      items: [item('a1'), item('a2', { entityType: 'session', action: 'login', entityLabel: 'Ana Gerente', changes: [], source: 'mobile' })],
      total: 2,
      page: 1,
      pageSize: 50,
    });

    render(<AuditPage />);

    await screen.findByText(/Preço unitário/); // espera sair do "Carregando..."
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Ana Gerente');
    expect(rows[1]).toHaveTextContent('Painel');
    expect(rows[1]).toHaveTextContent('Alteração');
    expect(rows[1]).toHaveTextContent('Produto');
    expect(rows[1]).toHaveTextContent('Arroz 5kg');
    expect(rows[1]).toHaveTextContent(/Preço unitário: R\$\s?10,00 → R\$\s?12,00/);
    expect(rows[2]).toHaveTextContent('Login');
    expect(rows[2]).toHaveTextContent('App');
    expect(rows[2]).toHaveTextContent('—');
    expect(api.get).toHaveBeenCalledWith('audit?page=1&pageSize=50');
  });

  it('filtros de entidade, ação e período entram na busca (período cobre o dia inteiro)', async () => {
    (api.get as Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    render(<AuditPage />);
    await screen.findByText('Nenhum registro encontrado.');

    await userEvent.selectOptions(screen.getByLabelText('Entidade'), 'product');
    await userEvent.selectOptions(screen.getByLabelText('Ação'), 'update');
    await userEvent.type(screen.getByLabelText('De'), '2026-09-01');
    await userEvent.type(screen.getByLabelText('Até'), '2026-09-24');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => {
      const last = (api.get as Mock).mock.calls.at(-1)![0] as string;
      const query = new URLSearchParams(last.split('?')[1]);
      expect(query.get('entityType')).toBe('product');
      expect(query.get('action')).toBe('update');
      expect(query.get('from')).toBe(new Date(2026, 8, 1).toISOString());
      expect(query.get('to')).toBe(new Date(2026, 8, 24, 23, 59, 59, 999).toISOString());
      expect(query.get('page')).toBe('1');
    });
  });

  it('exportar CSV baixa com os mesmos filtros (sem paginação)', async () => {
    (api.get as Mock).mockResolvedValue({ items: [item('a1')], total: 1, page: 1, pageSize: 50 });
    (api.getBlob as Mock).mockResolvedValue(new Blob(['x']));
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    render(<AuditPage />);
    await screen.findAllByRole('row');

    await userEvent.selectOptions(screen.getByLabelText('Entidade'), 'user');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    await waitFor(() => expect(api.getBlob).toHaveBeenCalledWith('audit/export?entityType=user'));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('erro da API (ex.: exportação grande demais) aparece na tela', async () => {
    (api.get as Mock).mockResolvedValue({ items: [item('a1')], total: 1, page: 1, pageSize: 50 });
    (api.getBlob as Mock).mockRejectedValue(new ApiError(400, 'A exportação tem 60000 linhas (máximo 50000).'));
    render(<AuditPage />);
    await screen.findAllByRole('row');

    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(await screen.findByText(/máximo 50000/)).toBeInTheDocument();
  });

  it('paginação pede a próxima página', async () => {
    (api.get as Mock).mockResolvedValue({ items: [item('a1')], total: 120, page: 1, pageSize: 50 });
    render(<AuditPage />);
    await screen.findAllByRole('row');

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('audit?page=2&pageSize=50'));
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();
  });
  it('resposta atrasada de uma página anterior é descartada (clicar "Próxima" rápido)', async () => {
    let resolvePage2: (value: unknown) => void = () => {};
    (api.get as Mock)
      .mockResolvedValueOnce({ items: [item('p1', { entityLabel: 'Linha da página 1' })], total: 150, page: 1, pageSize: 50 })
      .mockImplementationOnce(() => new Promise((resolve) => (resolvePage2 = resolve)))
      .mockResolvedValueOnce({ items: [item('p3', { entityLabel: 'Linha da página 3' })], total: 150, page: 3, pageSize: 50 });
    render(<AuditPage />);
    await screen.findByText(/Linha da página 1/);

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByText(/Linha da página 3/);
    resolvePage2({ items: [item('p2', { entityLabel: 'Linha da página 2' })], total: 150, page: 2, pageSize: 50 });

    await waitFor(() => expect(screen.getByText('Página 3 de 3')).toBeInTheDocument());
    expect(screen.queryByText(/Linha da página 2/)).not.toBeInTheDocument();
    expect(screen.getByText(/Linha da página 3/)).toBeInTheDocument();
  });

  it('erro ao carregar não deixa na tela as linhas da busca anterior', async () => {
    (api.get as Mock)
      .mockResolvedValueOnce({ items: [item('p1', { entityLabel: 'Linha da página 1' })], total: 150, page: 1, pageSize: 50 })
      .mockRejectedValueOnce(new ApiError(500, 'Erro interno.'));
    render(<AuditPage />);
    await screen.findByText(/Linha da página 1/);

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(await screen.findByText('Erro interno.')).toBeInTheDocument();
    expect(screen.queryByText(/Linha da página 1/)).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhum registro encontrado.')).not.toBeInTheDocument();
  });
});

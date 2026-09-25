import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoryDrawer } from './history-drawer';
import { api, ApiError } from '@/lib/api-client';
import type { AuditLogEntry } from '@/lib/types';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn() },
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
    entityLabel: 'Arroz',
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

function page(items: AuditLogEntry[]) {
  return { items, total: items.length, page: 1, pageSize: 100 };
}

describe('HistoryDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ao abrir, busca o histórico daquele registro e mostra quem, de onde e o quê', async () => {
    (api.get as Mock).mockResolvedValue(page([item('a1')]));

    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />);

    const list = await screen.findByRole('list', { name: 'Histórico de alterações' });
    expect(list).toHaveTextContent('Ana Gerente');
    expect(list).toHaveTextContent('Painel');
    expect(list).toHaveTextContent('Alteração');
    expect(list).toHaveTextContent(/Preço unitário: R\$\s?10,00 → R\$\s?12,00/);
    expect(api.get).toHaveBeenCalledWith('audit?entityType=product&entityId=p1&pageSize=100');
  });

  it('fechado não busca nada', () => {
    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open={false} onOpenChange={() => {}} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('sem registros mostra aviso; erro da API aparece', async () => {
    (api.get as Mock).mockResolvedValueOnce(page([]));
    const { unmount } = render(
      <HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />,
    );
    expect(await screen.findByText('Nenhuma alteração registrada.')).toBeInTheDocument();
    unmount();

    (api.get as Mock).mockRejectedValueOnce(new ApiError(403, 'Acesso negado.'));
    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />);
    expect(await screen.findByText('Acesso negado.')).toBeInTheDocument();
  });

  it('autor ausente (sistema/importação) aparece como "Sistema"', async () => {
    (api.get as Mock).mockResolvedValue(page([item('a1', { actorName: null, source: 'system' })]));
    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />);
    const list = await screen.findByRole('list', { name: 'Histórico de alterações' });
    expect(list).toHaveTextContent('Sistema');
  });

  it('resposta atrasada de outro registro é descartada', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    (api.get as Mock)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(page([item('b1', { entityId: 'p2', changes: [{ field: 'name', from: 'B', to: 'C' }] })]));

    const { rerender } = render(
      <HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />,
    );
    rerender(<HistoryDrawer entityType="product" entityId="p2" title="Feijão" open onOpenChange={() => {}} />);
    const list = await screen.findByRole('list', { name: 'Histórico de alterações' });
    resolveFirst(page([item('a1', { changes: [{ field: 'name', from: 'X', to: 'ERRADO' }] })]));

    await waitFor(() => expect(list).toHaveTextContent('Nome: B → C'));
    expect(screen.queryByText(/ERRADO/)).not.toBeInTheDocument();
  });
});

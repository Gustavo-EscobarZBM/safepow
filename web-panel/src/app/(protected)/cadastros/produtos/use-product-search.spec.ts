import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api-client';
import type { Product, ProductSearchResult } from '@/lib/types';
import { useProductSearch } from './use-product-search';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn() },
}));

function product(id: string, name: string): Product {
  return { id, name, barcode: id, sku: null, unitPrice: 1, costPrice: 1, isActive: true };
}

function result(items: Product[], total = items.length, page = 1): ProductSearchResult {
  return { items, total, page, pageSize: 20 };
}

function calls(): string[] {
  return (api.get as Mock).mock.calls.map((call) => call[0] as string);
}

describe('useProductSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockResolvedValue(result([product('p-1', 'Arroz')]));
  });

  it('busca inicial: ativos, página 1, 20 por página', async () => {
    const { result: hook } = renderHook(() => useProductSearch());

    await waitFor(() => expect(hook.current.items).toHaveLength(1));
    expect(calls()).toEqual(['products/search?status=active&page=1&pageSize=20']);
    expect(hook.current).toMatchObject({ total: 1, totalPages: 1, loading: false, error: null });
  });

  it('debounce: digitar rápido faz UMA busca, com o texto final', async () => {
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));

    act(() => hook.current.setSearch('a'));
    act(() => hook.current.setSearch('ar'));
    act(() => hook.current.setSearch('arr'));

    await waitFor(() => expect(calls()).toContain('products/search?q=arr&status=active&page=1&pageSize=20'));
    expect(calls().filter((path) => path.includes('q='))).toEqual([
      'products/search?q=arr&status=active&page=1&pageSize=20',
    ]);
  });

  it('trocar o status volta para a página 1', async () => {
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));
    (api.get as Mock).mockResolvedValue(result([product('p-1', 'Arroz')], 60, 3));

    act(() => hook.current.setPage(3));
    await waitFor(() => expect(calls()).toContain('products/search?status=active&page=3&pageSize=20'));
    act(() => hook.current.setStatus('archived'));

    await waitFor(() => expect(calls()).toContain('products/search?status=archived&page=1&pageSize=20'));
    expect(hook.current.page).toBe(1);
  });

  it('resposta atrasada é descartada: vale o resultado da ÚLTIMA busca pedida', async () => {
    let resolveFirst: (value: ProductSearchResult) => void = () => undefined;
    (api.get as Mock).mockImplementation((path: string) =>
      path.includes('status=active')
        ? new Promise<ProductSearchResult>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(result([product('p-b', 'Arquivado')])),
    );
    const { result: hook } = renderHook(() => useProductSearch());

    act(() => hook.current.setStatus('archived'));
    await waitFor(() => expect(hook.current.items.map((p) => p.name)).toEqual(['Arquivado']));
    await act(async () => resolveFirst(result([product('p-a', 'Ativo atrasado')])));

    expect(hook.current.items.map((p) => p.name)).toEqual(['Arquivado']);
    expect(hook.current.loading).toBe(false);
  });

  it('página além do total (último item da página arquivado): volta para a última página que existe', async () => {
    (api.get as Mock).mockImplementation(async (path: string) =>
      path.includes('page=3') ? result([], 40, 3) : result([product('p-1', 'Arroz')], 40, 2),
    );
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));

    act(() => hook.current.setPage(3));

    await waitFor(() => expect(hook.current.page).toBe(2));
    expect(calls()).toContain('products/search?status=active&page=2&pageSize=20');
    expect(hook.current.totalPages).toBe(2);
  });

  it('reload repete a busca atual', async () => {
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));

    act(() => hook.current.reload());

    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1]).toBe(calls()[0]);
  });

  it('erro da busca vira mensagem', async () => {
    (api.get as Mock).mockRejectedValue(new Error('rede'));
    const { result: hook } = renderHook(() => useProductSearch());

    await waitFor(() => expect(hook.current.error).toBe('Erro ao carregar produtos.'));
    expect(hook.current.loading).toBe(false);
  });
});

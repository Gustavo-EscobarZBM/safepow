import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsPage from './page';
import { api, ApiError } from '@/lib/api-client';
import type { PriceHistoryEntry } from '@/lib/types';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const products = [
  { id: 'p-a', barcode: '111', sku: null, name: 'Arroz 5kg', unitPrice: '12.00', costPrice: '6.00', isActive: true },
  { id: 'p-b', barcode: '222', sku: null, name: 'Feijão 1kg', unitPrice: '8.00', costPrice: '4.00', isActive: true },
];

function history(unitPrice: number, id: string): PriceHistoryEntry[] {
  return [
    {
      id,
      unitPrice,
      costPrice: 1,
      validFrom: '2026-09-10T17:05:00.000Z',
      source: 'manual',
      changedByUserId: null,
      changedByName: null,
    },
  ];
}

describe('ProductsPage — linha do tempo de preços no diálogo de edição', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ao abrir a edição, busca e mostra o histórico daquele produto', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path === 'products') return products;
      if (path === 'products/p-a/price-history') return history(12, 'h-a');
      throw new Error(`unexpected path: ${path}`);
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));

    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByRole('list', { name: /histórico de preços/i });
    expect(list).toHaveTextContent(/12,00/);
    expect(api.get).toHaveBeenCalledWith('products/p-a/price-history');
  });

  it('erro no histórico não bloqueia a edição: mostra a mensagem e o botão de salvar continua ativo', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path === 'products') return products;
      throw new ApiError(500, 'Histórico indisponível.');
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Histórico indisponível.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Salvar alterações' })).toBeEnabled();
  });

  it('resposta atrasada de outro produto não aparece no diálogo do produto aberto depois', async () => {
    let resolveA: (value: PriceHistoryEntry[]) => void = () => undefined;
    (api.get as Mock).mockImplementation((path: string) => {
      if (path === 'products') return Promise.resolve(products);
      if (path === 'products/p-a/price-history') {
        return new Promise<PriceHistoryEntry[]>((resolve) => {
          resolveA = resolve;
        });
      }
      if (path === 'products/p-b/price-history') return Promise.resolve(history(8, 'h-b'));
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Feijão 1kg' }));

    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByRole('list', { name: /histórico de preços/i });
    expect(list).toHaveTextContent(/8,00/);

    resolveA(history(99, 'h-a')); // chega depois, com o diálogo do Feijão aberto
    await new Promise((r) => setTimeout(r, 0));

    expect(within(dialog).getByRole('list', { name: /histórico de preços/i })).not.toHaveTextContent(/99,00/);
  });
});

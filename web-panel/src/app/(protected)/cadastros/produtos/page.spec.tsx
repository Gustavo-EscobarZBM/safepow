import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsPage from './page';
import { api, ApiError } from '@/lib/api-client';
import type { PriceHistoryEntry } from '@/lib/types';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() },
}));

const products = [
  { id: 'p-a', barcode: '111', sku: null, name: 'Arroz 5kg', unitPrice: '12.00', costPrice: '6.00', isActive: true },
  { id: 'p-b', barcode: '222', sku: null, name: 'Feijão 1kg', unitPrice: '8.00', costPrice: '4.00', isActive: true },
];

function searchResult(items: typeof products, total = items.length) {
  return { items, total, page: 1, pageSize: 20 };
}

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
      if (path.startsWith('products/search')) return searchResult(products);
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

  it('o diálogo de edição tem altura limitada e rola por dentro (celular: Salvar nunca fica fora da tela)', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('products/search')) return searchResult(products);
      if (path === 'products/p-a/price-history') return history(12, 'h-a');
      throw new Error(`unexpected path: ${path}`);
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));

    expect(await screen.findByRole('dialog')).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto');
  });

  it('erro no histórico não bloqueia a edição: mostra a mensagem e o botão de salvar continua ativo', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('products/search')) return searchResult(products);
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
      if (path.startsWith('products/search')) return Promise.resolve(searchResult(products));
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

describe('ProductsPage — busca no servidor, abas e ciclo de vida (etapa 1.3)', () => {
  const archived = { ...products[1], isActive: false };

  function searchCalls(): string[] {
    return (api.get as Mock).mock.calls.map((call) => call[0] as string).filter((p) => p.startsWith('products/search'));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.includes('status=archived')) return searchResult([archived]);
      if (path.startsWith('products/search')) return searchResult([products[0]], 45);
      throw new Error(`unexpected path: ${path}`);
    });
    (api.delete as Mock).mockResolvedValue(undefined);
    (api.patch as Mock).mockResolvedValue({});
  });

  it('carrega pela busca do servidor e pagina com o total do servidor', async () => {
    render(<ProductsPage />);

    expect(await screen.findByText('Arroz 5kg')).toBeInTheDocument();
    expect(searchCalls()[0]).toBe('products/search?status=active&page=1&pageSize=20');
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(searchCalls()).toContain('products/search?status=active&page=2&pageSize=20'));
  });

  it('abas: Arquivados troca o status da busca; Todos também', async () => {
    render(<ProductsPage />);
    await screen.findByText('Arroz 5kg');

    await userEvent.click(screen.getByRole('tab', { name: 'Arquivados' }));
    await waitFor(() => expect(searchCalls()).toContain('products/search?status=archived&page=1&pageSize=20'));
    await userEvent.click(screen.getByRole('tab', { name: 'Todos' }));
    await waitFor(() => expect(searchCalls()).toContain('products/search?status=all&page=1&pageSize=20'));
  });

  it('"Excluir" virou "Arquivar": o diálogo explica e arquivar chama DELETE e recarrega', async () => {
    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Arquivar Arroz 5kg' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/deixará de aparecer no app dos funcionários/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/histórico de perdas/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/reativá-lo depois/i)).toBeInTheDocument();
    const before = searchCalls().length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }));

    expect(api.delete).toHaveBeenCalledWith('products/p-a');
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(before));
    expect(screen.queryByRole('button', { name: /excluir/i })).not.toBeInTheDocument();
  });

  it('arquivados mostram o selo e a ação Reativar (PATCH …/restore), sem a ação Arquivar', async () => {
    render(<ProductsPage />);
    await screen.findByText('Arroz 5kg');
    await userEvent.click(screen.getByRole('tab', { name: 'Arquivados' }));

    expect(await screen.findByText('Arquivado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arquivar Feijão 1kg' })).not.toBeInTheDocument();
    const before = searchCalls().length;
    await userEvent.click(screen.getByRole('button', { name: 'Reativar Feijão 1kg' }));

    expect(api.patch).toHaveBeenCalledWith('products/p-b/restore');
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(before));
  });
});

describe('ProductsPage — cadastro de código de produto arquivado (etapa 1.3)', () => {
  const archivedConflict = new ApiError(
    409,
    'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
    {
      statusCode: 409,
      errorCode: 'PRODUCT_ARCHIVED_EXISTS',
      message: 'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
      productId: 'p-z',
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('products/search')) return searchResult([products[0]]);
      throw new Error(`unexpected path: ${path}`);
    });
  });

  async function fillAndSubmit() {
    render(<ProductsPage />);
    await screen.findByText('Arroz 5kg');
    const [barcodeInput, nameInput, priceInput] = screen.getAllByRole('textbox').slice(0, 2).concat(
      screen.getAllByRole('spinbutton').slice(0, 1),
    );
    await userEvent.type(barcodeInput, '999');
    await userEvent.type(nameInput, 'Macarrão');
    await userEvent.type(priceInput, '7.5');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar produto' }));
  }

  it('conflito com produto ARQUIVADO: mostra o aviso e "Reativar e atualizar os dados" reativa e grava o formulário', async () => {
    (api.post as Mock).mockRejectedValue(archivedConflict);
    (api.patch as Mock).mockResolvedValue({});
    await fillAndSubmit();

    expect(await screen.findByText(/existe um produto arquivado com este código/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reativar e atualizar os dados' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect((api.patch as Mock).mock.calls[0]).toEqual(['products/p-z/restore']);
    expect((api.patch as Mock).mock.calls[1]).toEqual([
      'products/p-z',
      { barcode: '999', name: 'Macarrão', unitPrice: 7.5, costPrice: undefined },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reativar e atualizar os dados' })).not.toBeInTheDocument(),
    );
  });

  it('mudar o código de barras depois do conflito retira a oferta de reativar (ela era daquele código)', async () => {
    (api.post as Mock).mockRejectedValue(archivedConflict);
    await fillAndSubmit();
    await screen.findByRole('button', { name: 'Reativar e atualizar os dados' });

    await userEvent.type(screen.getByDisplayValue('999'), '8');

    expect(screen.queryByRole('button', { name: 'Reativar e atualizar os dados' })).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('conflito com produto ATIVO: só a mensagem, sem oferecer reativar', async () => {
    (api.post as Mock).mockRejectedValue(
      new ApiError(409, 'Já existe um produto com este código de barras.', {
        statusCode: 409,
        errorCode: 'PRODUCT_BARCODE_EXISTS',
        message: 'Já existe um produto com este código de barras.',
      }),
    );
    await fillAndSubmit();

    expect(await screen.findByText('Já existe um produto com este código de barras.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reativar e atualizar os dados' })).not.toBeInTheDocument();
  });

  it('falha no PATCH depois do restore: mostra o erro, mantém o formulário e recarrega a lista', async () => {
    (api.post as Mock).mockRejectedValue(archivedConflict);
    (api.patch as Mock)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError(400, 'name must be longer than or equal to 2 characters'));
    await fillAndSubmit();
    const searchesBefore = (api.get as Mock).mock.calls.length;

    await userEvent.click(await screen.findByRole('button', { name: 'Reativar e atualizar os dados' }));

    expect(await screen.findByText(/produto foi reativado, mas os dados não foram atualizados/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Macarrão')).toBeInTheDocument();
    await waitFor(() => expect((api.get as Mock).mock.calls.length).toBeGreaterThan(searchesBefore));
  });
});

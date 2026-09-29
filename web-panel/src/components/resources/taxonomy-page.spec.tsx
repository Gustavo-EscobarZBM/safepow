import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '@/lib/api-client';
import { TaxonomyPage } from './taxonomy-page';
import { BRANDS_PAGE, CATEGORIES_PAGE, SUPPLIERS_PAGE } from './taxonomy-configs';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), getBlob: vi.fn() },
}));

const BRANDS = [
  { id: 'b1', name: 'Coca-Cola', isActive: true },
  { id: 'b2', name: 'Antiga', isActive: false },
];
const CATEGORIES = [
  { id: 'c1', name: 'Mercearia', parentId: null, path: 'Mercearia', isActive: true },
  { id: 'c2', name: 'Bebidas', parentId: 'c1', path: 'Mercearia > Bebidas', isActive: true },
  { id: 'c3', name: 'Refrigerantes', parentId: 'c2', path: 'Mercearia > Bebidas > Refrigerantes', isActive: true },
  { id: 'c4', name: 'Limpeza', parentId: null, path: 'Limpeza', isActive: true },
];

function mockList(resource: string, rows: unknown[]) {
  (api.get as Mock).mockImplementation(async (path: string) => {
    if (path === `${resource}?includeArchived=true`) return rows;
    if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('TaxonomyPage (SP4 4.1)', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.post, api.patch]) (fn as Mock).mockReset();
  });

  it('marcas: mostra só as ativas na aba Ativos e as arquivadas na outra aba, com Reativar', async () => {
    mockList('brands', BRANDS);
    render(<TaxonomyPage {...BRANDS_PAGE} />);
    expect(screen.getByRole('heading', { name: 'Marcas' })).toBeInTheDocument();
    expect(await screen.findByText('Coca-Cola')).toBeInTheDocument();
    expect(screen.queryByText('Antiga')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Arquivadas' }));
    const row = screen.getByRole('row', { name: /Antiga/ });
    (api.post as Mock).mockResolvedValue({});
    await userEvent.click(within(row).getByRole('button', { name: 'Reativar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('brands/b2/restore', {}));
  });

  it('marcas: cria pela janela e mostra o 409 dentro dela', async () => {
    mockList('brands', BRANDS);
    render(<TaxonomyPage {...BRANDS_PAGE} />);
    await screen.findByText('Coca-Cola');
    (api.post as Mock).mockRejectedValueOnce(new ApiError(409, 'Já existe uma marca com este nome.'));

    await userEvent.click(screen.getByRole('button', { name: 'Nova marca' }));
    await userEvent.type(screen.getByLabelText('Nome'), 'coca-cola');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Já existe uma marca com este nome.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('brands', { name: 'coca-cola' });
  });

  it('arquivar pede confirmação e chama archive', async () => {
    mockList('brands', BRANDS);
    render(<TaxonomyPage {...BRANDS_PAGE} />);
    const row = await screen.findByRole('row', { name: /Coca-Cola/ });
    (api.post as Mock).mockResolvedValue({});
    await userEvent.click(within(row).getByRole('button', { name: 'Arquivar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Arquivar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('brands/b1/archive', {}));
  });

  it('categorias: mostra o caminho; o pai não oferece a própria, as descendentes nem o 3º nível', async () => {
    mockList('categories', CATEGORIES);
    render(<TaxonomyPage {...CATEGORIES_PAGE} />);
    expect(await screen.findByText('Mercearia > Bebidas')).toBeInTheDocument();

    const row = screen.getAllByRole('row').find((r) => within(r).queryAllByRole('cell')[0]?.textContent === 'Mercearia')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const parent = screen.getByLabelText('Categoria pai') as HTMLSelectElement;
    expect([...parent.options].map((o) => o.textContent)).toEqual(['Nenhuma (categoria principal)', 'Limpeza']);
  });

  it('categorias: cria subcategoria enviando parentId e principal enviando null', async () => {
    mockList('categories', CATEGORIES);
    (api.post as Mock).mockResolvedValue({});
    render(<TaxonomyPage {...CATEGORIES_PAGE} />);
    await screen.findByText('Limpeza');

    await userEvent.click(screen.getByRole('button', { name: 'Nova categoria' }));
    await userEvent.type(screen.getByLabelText('Nome'), 'Sucos');
    await userEvent.selectOptions(screen.getByLabelText('Categoria pai'), 'c2');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('categories', { name: 'Sucos', parentId: 'c2' }));

    await userEvent.click(screen.getByRole('button', { name: 'Nova categoria' }));
    await userEvent.type(screen.getByLabelText('Nome'), 'Hortifrúti');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('categories', { name: 'Hortifrúti', parentId: null }));
  });

  it('fornecedores: formulário com contato e colunas de contato', async () => {
    mockList('suppliers', [{ id: 's1', name: 'Laticínios X', contactName: 'Maria', phone: '(11) 9999', isActive: true }]);
    (api.patch as Mock).mockResolvedValue({});
    render(<TaxonomyPage {...SUPPLIERS_PAGE} />);
    const row = await screen.findByRole('row', { name: /Laticínios X/ });
    expect(within(row).getByText('Maria')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const email = screen.getByLabelText('E-mail');
    await userEvent.type(email, 'maria@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('suppliers/s1', expect.objectContaining({ name: 'Laticínios X', email: 'maria@x.com' })),
    );
  });
});

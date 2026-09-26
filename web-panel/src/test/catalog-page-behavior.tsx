import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '@/lib/api-client';

/**
 * Comportamento das telas de "cadastrinho" (Motivo e Local da Perda), registrado ANTES da troca para os blocos
 * do motor de cadastros (SP2, 2.4) — é a prova de "sem mudança visível". O arquivo de teste de cada tela chama
 * esta função com o próprio `vi.mock('@/lib/api-client')`.
 */
export interface CatalogPageConfig {
  Page: ComponentType;
  resource: 'loss-reasons' | 'loss-locations';
  title: string;
  description: string;
  itemLabelLower: string; // "motivo" | "local"
}

export function describeCatalogPageBehavior({ Page, resource, title, description, itemLabelLower }: CatalogPageConfig) {
  const ROWS = [
    { id: 'r1', name: 'Quebra' },
    { id: 'r2', name: 'Furto' },
  ];
  const listCalls = () => (api.get as Mock).mock.calls.filter((call) => call[0] === resource).length;
  const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

  describe(`${title} — comportamento atual`, () => {
    beforeEach(() => {
      (api.get as Mock).mockReset();
      (api.post as Mock).mockReset();
      (api.patch as Mock).mockReset();
      (api.delete as Mock).mockReset();
      (api.get as Mock).mockImplementation(async (path: string) => {
        if (path === resource) return ROWS;
        if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
        throw new Error(`unexpected path: ${path}`);
      });
    });

    it('mostra título, descrição e as linhas', async () => {
      render(<Page />);
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();
      expect(await screen.findByText('Quebra')).toBeInTheDocument();
      expect(screen.getByText('Furto')).toBeInTheDocument();
      expect(api.get).toHaveBeenCalledWith(resource);
    });

    it('carregando e lista vazia', async () => {
      let resolve: (value: unknown) => void = () => {};
      (api.get as Mock).mockImplementation(() => new Promise((r) => (resolve = r)));
      render(<Page />);
      expect(screen.getByText('Carregando...')).toBeInTheDocument();
      resolve([]);
      expect(await screen.findByText(`Nenhum ${itemLabelLower} cadastrado ainda.`)).toBeInTheDocument();
    });

    it('erro ao carregar mostra a mensagem e sai do "Carregando..."', async () => {
      (api.get as Mock).mockRejectedValue(new ApiError(500, 'Falha ao listar.'));
      render(<Page />);
      expect(await screen.findByText('Falha ao listar.')).toBeInTheDocument();
      expect(screen.queryByText('Carregando...')).not.toBeInTheDocument();
    });

    it('cadastrar envia o nome, limpa o campo e recarrega', async () => {
      (api.post as Mock).mockResolvedValue({ id: 'r3', name: 'Vencido' });
      render(<Page />);
      await screen.findByText('Quebra');
      const input = screen.getByPlaceholderText(`Nome do ${itemLabelLower}`);
      const before = listCalls();

      await userEvent.type(input, 'Vencido');
      await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith(resource, { name: 'Vencido' }));
      await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
      expect(input).toHaveValue('');
    });

    it('erro ao cadastrar mostra a mensagem e mantém o texto', async () => {
      (api.post as Mock).mockRejectedValue(new ApiError(409, 'Já existe um cadastro com esse nome.'));
      render(<Page />);
      await screen.findByText('Quebra');
      const input = screen.getByPlaceholderText(`Nome do ${itemLabelLower}`);

      await userEvent.type(input, 'Quebra');
      await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

      expect(await screen.findByText('Já existe um cadastro com esse nome.')).toBeInTheDocument();
      expect(input).toHaveValue('Quebra');
    });

    it('editar abre o diálogo com o nome, salva e recarrega', async () => {
      (api.patch as Mock).mockResolvedValue({ id: 'r1', name: 'Quebra/Avaria' });
      render(<Page />);
      await screen.findByText('Quebra');

      await userEvent.click(within(rowOf('Quebra')).getByRole('button', { name: /Editar/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(`Editar ${itemLabelLower}`)).toBeInTheDocument();
      expect(within(dialog).getByText('Altere o nome e salve.')).toBeInTheDocument();
      const field = within(dialog).getByDisplayValue('Quebra');
      await userEvent.clear(field);
      await userEvent.type(field, 'Quebra/Avaria');
      const before = listCalls();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${resource}/r1`, { name: 'Quebra/Avaria' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
    });

    it('erro ao editar fica no diálogo, que continua aberto', async () => {
      (api.patch as Mock).mockRejectedValue(new ApiError(409, 'Nome já usado.'));
      render(<Page />);
      await screen.findByText('Quebra');

      await userEvent.click(within(rowOf('Quebra')).getByRole('button', { name: /Editar/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialog).findByText('Nome já usado.')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('excluir chama DELETE e recarrega; erro mostra a mensagem e mantém a lista', async () => {
      (api.delete as Mock).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(409, 'Em uso em perdas.'));
      render(<Page />);
      await screen.findByText('Quebra');
      const before = listCalls();

      await userEvent.click(within(rowOf('Quebra')).getByRole('button', { name: /Excluir/ }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${resource}/r1`));
      await waitFor(() => expect(listCalls()).toBeGreaterThan(before));

      await userEvent.click(within(rowOf('Furto')).getByRole('button', { name: /Excluir/ }));
      expect(await screen.findByText('Em uso em perdas.')).toBeInTheDocument();
      expect(screen.getByText('Furto')).toBeInTheDocument();
    });
  });
}

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './page';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), getBlob: vi.fn() },
}));

describe('UsersPage — gaveta Histórico', () => {
  beforeEach(() => vi.clearAllMocks());

  it('abre o histórico do usuário pela linha', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      return [{ id: 'u-1', name: 'Ana', email: 'ana@x.com', role: 'employee', isActive: true }];
    });

    render(<UsersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico de Ana' }));

    expect(await screen.findByText('Histórico — Ana')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('audit?entityType=user&entityId=u-1&pageSize=100');
  });
});

describe('UsersPage — exportar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('"Exportar" baixa a lista de usuários', async () => {
    (api.get as Mock).mockResolvedValue([]);
    (api.getBlob as Mock).mockResolvedValue(new Blob(['x']));
    Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<UsersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));
    await waitFor(() => expect(api.getBlob).toHaveBeenCalledWith('users/export?format=csv'));
    click.mockRestore();
  });
});

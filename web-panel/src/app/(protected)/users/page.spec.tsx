import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './page';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

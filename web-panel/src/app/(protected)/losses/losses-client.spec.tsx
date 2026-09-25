import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LossesClient } from './losses-client';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), getBlob: vi.fn(), postForm: vi.fn() },
}));

const loss = {
  id: 'l-1',
  productId: 'p-1',
  product: { name: 'Arroz 5kg' },
  quantity: '2',
  reason: { name: 'Quebra/Avaria' },
  location: { name: 'Depósito/Estoque' },
  description: null,
  reportedBy: { name: 'João' },
  imageUrl: null,
  occurredAt: '2026-09-24T12:00:00.000Z',
};

describe('LossesClient — gaveta Histórico', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gerente abre o histórico da perda pela linha', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      if (path.startsWith('losses')) return [loss];
      return []; // products, loss-reasons, loss-locations: arrays
    });

    render(<LossesClient role="manager" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico da perda' }));

    expect(api.get).toHaveBeenCalledWith('audit?entityType=loss&entityId=l-1&pageSize=100');
  });
});

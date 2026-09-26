import { vi } from 'vitest';
import LossLocationsPage from './page';
import { describeCatalogPageBehavior } from '@/test/catalog-page-behavior';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describeCatalogPageBehavior({
  Page: LossLocationsPage,
  resource: 'loss-locations',
  title: 'Local da Perda',
  description: 'Opções de local disponíveis ao registrar uma perda. Um local já usado em alguma perda não pode ser excluído.',
  itemLabelLower: 'local',
});

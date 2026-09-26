import { vi } from 'vitest';
import LossReasonsPage from './page';
import { describeCatalogPageBehavior } from '@/test/catalog-page-behavior';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describeCatalogPageBehavior({
  Page: LossReasonsPage,
  resource: 'loss-reasons',
  title: 'Motivo da Perda',
  description: 'Opções de motivo disponíveis ao registrar uma perda. Um motivo já usado em alguma perda não pode ser excluído.',
  auditEntityType: 'loss_reason',
  itemLabelLower: 'motivo',
});

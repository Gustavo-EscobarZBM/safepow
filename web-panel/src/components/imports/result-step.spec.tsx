import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultStep } from './result-step';
import { api } from '@/lib/api-client';
import type { ImportJob, ImportSummary } from '@/lib/imports';

// Link do Next marcado, para distinguir de <a href> (navegação completa).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), getBlob: vi.fn() },
}));

const SUMMARY: ImportSummary = {
  totalRows: 10,
  counts: { create: 3, update: 4, reactivate: 1, unchanged: 2, error: 1, duplicate: 0, archive: 0 },
  warnings: {},
  missingCount: 2,
  sensitive: { priceChange: 0, archiveWithHistory: 0 },
};

function job(overrides: Partial<ImportJob>): ImportJob {
  return {
    id: 'j1',
    status: 'completed',
    fileName: 'produtos.xlsx',
    createdByUserId: 'u-author',
    summary: SUMMARY,
    options: { updateFields: [] },
    lastError: null,
    errorReportKey: null,
    ...overrides,
  } as ImportJob;
}

function renderStep(value: ImportJob, currentUserId = 'u-author') {
  const onJobChange = vi.fn();
  const onAdjustColumns = vi.fn();
  render(<ResultStep job={value} currentUserId={currentUserId} onJobChange={onJobChange} onAdjustColumns={onAdjustColumns} />);
  return { onJobChange, onAdjustColumns };
}

describe('ResultStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockResolvedValue({ items: [], total: 0 });
  });

  it('gravando: barra com o progresso das linhas aplicáveis', () => {
    renderStep(job({ status: 'applying', summary: { ...SUMMARY, appliedCount: 5 } }));
    expect(screen.getByText('Gravando: 5 de 10 linhas')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('aguardando aprovação: link para os pedidos e cancelar', async () => {
    const cancelled = job({ status: 'cancelled' });
    (api.post as Mock).mockResolvedValue({ job: cancelled });
    const { onJobChange } = renderStep(job({ status: 'pending_approval' }));
    expect(screen.getByText('Aguardando aprovação de outro gerente.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver pedidos' })).toHaveAttribute('href', '/aprovacoes');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar importação' }));
    await waitFor(() => expect(onJobChange).toHaveBeenCalledWith(cancelled));
    expect(api.post).toHaveBeenCalledWith('imports/j1/cancel');
  });

  it('aguardando aprovação: mostra a simulação em leitura', async () => {
    renderStep(job({ status: 'pending_approval' }));
    expect(screen.getByTestId('summary-cards')).toHaveTextContent('Atualizar');
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });

  it('aguardando aprovação vista por outro gerente: sem "Cancelar" e com o convite para decidir', () => {
    renderStep(job({ status: 'pending_approval' }), 'u-approver');
    expect(screen.queryByRole('button', { name: 'Cancelar importação' })).not.toBeInTheDocument();
    expect(screen.getByText('Esta importação aguarda aprovação. Decida o pedido na fila de aprovações.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver pedidos' })).toHaveAttribute('href', '/aprovacoes');
  });

  it('"Nova importação" recarrega a página (não reaproveita o assistente do job anterior)', () => {
    renderStep(job({ status: 'completed' }));
    const link = screen.getByRole('link', { name: 'Nova importação' });
    expect(link).toHaveAttribute('href', '/cadastros/importacoes/nova');
    expect(link).not.toHaveAttribute('data-next-link');
  });

  it('concluída há poucos dias: "Reverter importação" abre a prévia', async () => {
    (api.get as Mock).mockResolvedValue({ restore: 4, conflicts: 0, items: [], total: 0, expiresAt: '2026-10-20T00:00:00Z' });
    renderStep(job({ status: 'completed', appliedAt: new Date().toISOString() }));
    await userEvent.click(screen.getByRole('button', { name: 'Reverter importação' }));
    expect(await screen.findByText('4 alterações serão desfeitas.')).toBeInTheDocument();
  });

  it('concluída há mais de 30 dias: sem reversão', () => {
    renderStep(job({ status: 'completed', appliedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString() }));
    expect(screen.queryByRole('button', { name: 'Reverter importação' })).not.toBeInTheDocument();
  });

  it('reversão que falhou: a mensagem aparece na concluída', () => {
    renderStep(job({ status: 'completed', appliedAt: new Date().toISOString(), lastError: 'banco caiu' }));
    expect(screen.getByText('A última tentativa de reverter falhou: banco caiu')).toBeInTheDocument();
  });

  it('reversão parada há mais de 5 minutos: "Tentar de novo" pede a reversão outra vez', async () => {
    const rolling = job({
      status: 'rolling_back',
      options: { updateFields: [], rollbackRequestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() },
    });
    const restarted = job({ status: 'rolling_back', options: { updateFields: [], rollbackRequestedAt: new Date().toISOString() } });
    (api.post as Mock).mockResolvedValue({ job: restarted });
    const { onJobChange } = renderStep(rolling);
    expect(screen.getByText(/A reversão parece parada/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(onJobChange).toHaveBeenCalledWith(restarted));
    expect(api.post).toHaveBeenCalledWith('imports/j1/rollback', {});
  });

  it('reversão recente: sem "Tentar de novo"', () => {
    renderStep(job({ status: 'rolling_back', options: { updateFields: [], rollbackRequestedAt: new Date().toISOString() } }));
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('revertendo e revertida', () => {
    const { unmount } = render(
      <ResultStep job={job({ status: 'rolling_back' })} currentUserId="u" onJobChange={vi.fn()} onAdjustColumns={vi.fn()} />,
    );
    expect(screen.getByText('Revertendo a importação…')).toBeInTheDocument();
    unmount();
    renderStep(job({ status: 'rolled_back', summary: { ...SUMMARY, rolledBackCount: 4, conflictCount: 1 } }));
    expect(screen.getByText('Importação revertida.')).toBeInTheDocument();
    expect(screen.getByText('Desfeitas').nextSibling).toHaveTextContent('4');
    expect(screen.getByText('Mantidas (mudaram depois)').nextSibling).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'Nova importação' })).toBeInTheDocument();
  });

  it('concluída: contagens finais e atalhos', () => {
    renderStep(job({ status: 'completed', options: { updateFields: [], archiveMissing: true } }));
    expect(screen.getByText('Importação concluída.')).toBeInTheDocument();
    expect(screen.getByText('Criados').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Atualizados').nextSibling).toHaveTextContent('4');
    expect(screen.getByText('Arquivados').nextSibling).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: 'Ver produtos' })).toHaveAttribute('href', '/cadastros/produtos');
    expect(screen.getByRole('link', { name: 'Nova importação' })).toHaveAttribute('href', '/cadastros/importacoes/nova');
  });

  it('gravação que falhou: mostra o erro e tenta de novo', async () => {
    const applying = job({ status: 'applying' });
    (api.post as Mock).mockResolvedValue({ job: applying });
    const { onJobChange } = renderStep(
      job({ status: 'failed', lastError: 'Conexão perdida.', options: { updateFields: [], applyStartedAt: '2026-09-27T10:00:00Z' } }),
    );
    expect(screen.getByText('Conexão perdida.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajustar colunas' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(onJobChange).toHaveBeenCalledWith(applying));
    expect(api.post).toHaveBeenCalledWith('imports/j1/retry');
    expect(screen.getByRole('button', { name: 'Cancelar importação' })).toBeInTheDocument();
  });

  it('simulação que falhou: mostra o erro e volta para as colunas', async () => {
    const { onAdjustColumns } = renderStep(job({ status: 'failed', lastError: 'Planilha ilegível.' }));
    expect(screen.getByText('Planilha ilegível.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar colunas' }));
    expect(onAdjustColumns).toHaveBeenCalled();
  });

  it('cancelada: motivo (ou texto padrão) e nova importação', () => {
    renderStep(job({ status: 'cancelled' }));
    expect(screen.getByText('Importação cancelada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nova importação' })).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultStep } from './result-step';
import { api } from '@/lib/api-client';
import type { ImportJob, ImportSummary } from '@/lib/imports';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { post: vi.fn(), getBlob: vi.fn() },
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
    summary: SUMMARY,
    options: { updateFields: [] },
    lastError: null,
    errorReportKey: null,
    ...overrides,
  } as ImportJob;
}

function renderStep(value: ImportJob) {
  const onJobChange = vi.fn();
  const onAdjustColumns = vi.fn();
  render(<ResultStep job={value} onJobChange={onJobChange} onAdjustColumns={onAdjustColumns} />);
  return { onJobChange, onAdjustColumns };
}

describe('ResultStep', () => {
  beforeEach(() => vi.clearAllMocks());

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

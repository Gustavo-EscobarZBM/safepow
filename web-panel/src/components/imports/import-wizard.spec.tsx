import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportWizard } from './import-wizard';
import { api } from '@/lib/api-client';
import type { ImportJob, ImportSummary, PreviewResult } from '@/lib/imports';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), getBlob: vi.fn() },
}));

const SUMMARY: ImportSummary = {
  totalRows: 2,
  counts: { create: 1, update: 1, reactivate: 0, unchanged: 0, error: 0, duplicate: 0, archive: 0 },
  warnings: {},
  missingCount: 0,
  sensitive: { priceChange: 0, archiveWithHistory: 0 },
};

const PREVIEW: PreviewResult = {
  headers: ['EAN', 'Nome'],
  sample: [['1', 'Arroz']],
  suggestedMapping: { barcode: 'EAN', name: 'Nome' },
  matchedMapping: null,
  fields: [
    { key: 'barcode', label: 'Código de barras', required: true, updatable: false },
    { key: 'name', label: 'Nome', required: true, updatable: true },
  ],
};

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'j1',
    status: 'uploaded',
    fileName: 'produtos.xlsx',
    sheetName: 'Produtos',
    sheets: ['Produtos'],
    summary: null,
    options: null,
    lastError: null,
    errorReportKey: null,
    mapping: null,
    ...overrides,
  } as ImportJob;
}

const jobGets = () => (api.get as Mock).mock.calls.filter((c) => c[0] === 'imports/j1').length;

function currentStep() {
  return document.querySelector('[aria-current="step"]')?.textContent;
}

describe('ImportWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (api.post as Mock).mockImplementation(async (path: string) => {
      if (path.endsWith('/preview')) return PREVIEW;
      throw new Error(`unexpected post ${path}`);
    });
  });
  afterEach(() => vi.useRealTimers());

  it('sem jobId começa pelo arquivo', () => {
    render(<ImportWizard />);
    expect(currentStep()).toBe('Arquivo');
    expect(screen.getByLabelText('Planilha (.xlsx ou .csv)')).toBeInTheDocument();
  });

  it('job enviado abre as colunas pedindo a prévia', async () => {
    (api.get as Mock).mockResolvedValue(job());
    render(<ImportWizard jobId="j1" />);
    expect(await screen.findByLabelText('Nome *')).toHaveValue('Nome');
    expect(currentStep()).toBe('Colunas');
    expect(api.post).toHaveBeenCalledWith('imports/j1/preview', { sheetName: 'Produtos' });
  });

  it('simulação que falhou volta às colunas mostrando o motivo', async () => {
    (api.get as Mock).mockResolvedValue(job({ status: 'failed', lastError: 'A coluna "Preço" sumiu da planilha.' }));
    render(<ImportWizard jobId="j1" />);
    expect(await screen.findByLabelText('Nome *')).toBeInTheDocument();
    expect(currentStep()).toBe('Colunas');
    expect(screen.getByText('A coluna "Preço" sumiu da planilha.')).toBeInTheDocument();
  });

  it('F5 com job simulado abre direto a simulação', async () => {
    (api.get as Mock).mockImplementation(async (path: string) =>
      path === 'imports/j1' ? job({ status: 'simulated', summary: SUMMARY }) : { items: [], total: 0 },
    );
    render(<ImportWizard jobId="j1" />);
    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
    expect(currentStep()).toBe('Simulação');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('simulando consulta a cada 2 s até ficar simulado', async () => {
    let status: ImportJob['status'] = 'simulating';
    (api.get as Mock).mockImplementation(async (path: string) =>
      path === 'imports/j1' ? job({ status, summary: status === 'simulated' ? SUMMARY : null }) : { items: [], total: 0 },
    );
    render(<ImportWizard jobId="j1" />);
    expect(await screen.findByText('Simulando a planilha…')).toBeInTheDocument();
    expect(jobGets()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(jobGets()).toBe(2);

    status = 'simulated';
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
  });

  it('gravando → concluída mostra o resultado e para de consultar', async () => {
    let status: ImportJob['status'] = 'applying';
    (api.get as Mock).mockImplementation(async () =>
      job({ status, summary: SUMMARY, options: { updateFields: [], applyStartedAt: '2026-09-27T10:00:00Z' } }),
    );
    render(<ImportWizard jobId="j1" />);
    expect(await screen.findByText(/Gravando: 0 de 2 linhas/)).toBeInTheDocument();
    status = 'completed';
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByText('Importação concluída.')).toBeInTheDocument();
    const calls = jobGets();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(jobGets()).toBe(calls);
    expect(currentStep()).toBe('Resultado');
  });

  it('upload de planilha já importada mostra o aviso e segue para as colunas', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    (api.postForm as Mock).mockResolvedValue({
      ...PREVIEW,
      job: job(),
      sheets: ['Produtos'],
      duplicateOf: { jobId: 'j0', fileName: 'produtos.xlsx', appliedAt: '2026-09-20T15:00:00Z', createdByName: 'Gerente Um' },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ImportWizard />);
    await user.upload(screen.getByLabelText('Planilha (.xlsx ou .csv)'), new File(['a'], 'produtos.xlsx'));
    await user.click(screen.getByRole('button', { name: 'Enviar planilha' }));

    expect(await screen.findByText('Esta planilha já foi importada em 20/09 por Gerente Um.')).toBeInTheDocument();
    expect(currentStep()).toBe('Colunas');
    expect(screen.getByLabelText('Nome *')).toHaveValue('Nome');
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(replaceState).toHaveBeenCalledWith(null, '', '/cadastros/importacoes/j1'));
  });

  it('"Voltar e ajustar colunas" volta às colunas com o mapeamento usado', async () => {
    (api.get as Mock).mockImplementation(async (path: string) =>
      path === 'imports/j1'
        ? job({ status: 'simulated', summary: SUMMARY, mapping: { barcode: 'EAN', name: 'EAN' } })
        : { items: [], total: 0 },
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ImportWizard jobId="j1" />);
    await user.click(await screen.findByRole('button', { name: 'Voltar e ajustar colunas' }));
    expect(await screen.findByLabelText('Nome *')).toHaveValue('EAN');
    expect(currentStep()).toBe('Colunas');
  });
});

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SimulationStep } from './simulation-step';
import { api, ApiError } from '@/lib/api-client';
import type { ImportJob, ImportRowView, ImportSummary } from '@/lib/imports';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), getBlob: vi.fn() },
}));

const SUMMARY: ImportSummary = {
  totalRows: 12,
  counts: { create: 3, update: 4, reactivate: 1, unchanged: 2, error: 1, duplicate: 1, archive: 0 },
  warnings: { GTIN_CHECK_DIGIT: 2 },
  missingCount: 0,
  sensitive: { priceChange: 0, archiveWithHistory: 0 },
};

function simulated(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'j1',
    status: 'simulated',
    fileName: 'produtos.xlsx',
    summary: SUMMARY,
    errorReportKey: null,
    options: { updateFields: ['name'] },
    ...overrides,
  } as ImportJob;
}

function row(overrides: Partial<ImportRowView>): ImportRowView {
  return {
    rowNumber: 2,
    key: '789',
    action: 'create',
    normalized: null,
    diff: null,
    warnings: [],
    errors: [],
    raw: null,
    ...overrides,
  };
}

function page(items: ImportRowView[]) {
  return { items, total: items.length };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function justificationRequired() {
  return new ApiError(409, 'Esta importação muda preços acima do limite.', {
    errorCode: 'JUSTIFICATION_REQUIRED',
    policy: 'price_change',
    mode: 'justification',
  });
}

function renderStep(job = simulated()) {
  const onBack = vi.fn();
  const onConfirmed = vi.fn();
  render(<SimulationStep job={job} onBack={onBack} onConfirmed={onConfirmed} />);
  return { onBack, onConfirmed };
}

describe('SimulationStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockResolvedValue(page([row({ key: '111', action: 'create' })]));
  });

  it('enquanto simula, mostra o aviso e não busca linhas', () => {
    renderStep(simulated({ status: 'simulating', summary: null }));
    expect(screen.getByText('Simulando a planilha…')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('mostra os cartões com as contagens e os avisos', async () => {
    renderStep();
    const cards = screen.getByTestId('summary-cards');
    expect(within(cards).getByText('Criar').nextSibling).toHaveTextContent('3');
    expect(within(cards).getByText('Atualizar').nextSibling).toHaveTextContent('4');
    expect(within(cards).getByText('Erros').nextSibling).toHaveTextContent('1');
    expect(within(cards).getByText('Avisos').nextSibling).toHaveTextContent('2');
    expect(screen.getByText(/Dígito verificador inválido/)).toHaveTextContent('2');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('imports/j1/rows?page=1&limit=20'));
  });

  it('filtro "Atualizar" busca action=update e mostra o diff formatado', async () => {
    renderStep();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    (api.get as Mock).mockResolvedValue(
      page([row({ key: '222', action: 'update', diff: { name: { from: 'Arroz', to: 'Arroz 5kg' } } })]),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Atualizar' }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('imports/j1/rows?action=update&page=1&limit=20'));
    expect(await screen.findByText('Nome: Arroz → Arroz 5kg')).toBeInTheDocument();
  });

  it('resposta atrasada de um filtro anterior não sobrescreve a atual', async () => {
    const slowAll = deferred<ReturnType<typeof page>>();
    (api.get as Mock).mockImplementation((path: string) =>
      path.includes('action=error')
        ? Promise.resolve(page([row({ key: 'ERR-1', action: 'error', errors: ['Código vazio'] })]))
        : slowAll.promise,
    );
    renderStep();
    await userEvent.click(screen.getByRole('tab', { name: 'Erros' }));
    expect(await screen.findByText('ERR-1')).toBeInTheDocument();
    await act(async () => slowAll.resolve(page([row({ key: 'OLD-1' })])));
    expect(screen.queryByText('OLD-1')).not.toBeInTheDocument();
    expect(screen.getByText('ERR-1')).toBeInTheDocument();
  });

  it('"Ver lista" mostra os produtos ausentes', async () => {
    (api.get as Mock).mockImplementation((path: string) =>
      path.includes('/missing')
        ? Promise.resolve({ items: [{ id: 'p1', key: '999', name: 'Feijão', hasLosses: true }], total: 1 })
        : Promise.resolve(page([])),
    );
    renderStep(simulated({ summary: { ...SUMMARY, missingCount: 1 } }));
    expect(screen.getByText('1 produto ativo não está na planilha')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver lista' }));
    expect(await screen.findByText('Feijão')).toBeInTheDocument();
    expect(screen.getByText('tem perdas')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('imports/j1/missing?page=1&limit=20');
  });

  it('baixa o relatório CSV quando existe', async () => {
    (api.getBlob as Mock).mockResolvedValue(new Blob(['x']));
    Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderStep(simulated({ errorReportKey: 'k' }));
    await userEvent.click(screen.getByRole('button', { name: 'Baixar relatório (CSV)' }));
    await waitFor(() => expect(api.getBlob).toHaveBeenCalledWith('imports/j1/report.csv'));
    await waitFor(() => expect(click).toHaveBeenCalled());
    click.mockRestore();
  });

  it('"Voltar e ajustar colunas" chama onBack', async () => {
    const { onBack } = renderStep();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar e ajustar colunas' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('confirmar simples grava e avisa com pending=false', async () => {
    const applying = simulated({ status: 'applying' });
    (api.post as Mock).mockResolvedValue({ job: applying });
    const { onConfirmed } = renderStep();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(applying, false));
    expect(api.post).toHaveBeenCalledWith('imports/j1/apply', { archiveMissing: false });
  });

  it('JUSTIFICATION_REQUIRED abre o diálogo e o reenvio leva a justificativa', async () => {
    const applying = simulated({ status: 'applying' });
    (api.post as Mock).mockRejectedValueOnce(justificationRequired()).mockResolvedValueOnce({ job: applying });
    const { onConfirmed } = renderStep();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    await userEvent.type(await screen.findByLabelText('Justificativa'), 'Tabela nova do fornecedor');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(applying, false));
    expect((api.post as Mock).mock.calls[1][1]).toEqual({ archiveMissing: false, justification: 'Tabela nova do fornecedor' });
  });

  it('resposta pendente de aprovação avisa com pending=true', async () => {
    const waiting = simulated({ status: 'pending_approval' });
    (api.post as Mock).mockResolvedValue({ status: 'pending', changeRequestId: 'c1', job: waiting });
    const { onConfirmed } = renderStep();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(waiting, true));
  });

  it('ARCHIVE_CONFIRMATION_REQUIRED pede o número e reenvia com confirmArchiveCount', async () => {
    const applying = simulated({ status: 'applying' });
    (api.post as Mock)
      .mockRejectedValueOnce(
        new ApiError(409, 'Arquivar 30 registros ausentes (mais de 20% do catálogo) exige confirmação: digite o número 30.', {
          errorCode: 'ARCHIVE_CONFIRMATION_REQUIRED',
          missingCount: 30,
        }),
      )
      .mockResolvedValueOnce({ job: applying });
    const { onConfirmed } = renderStep(simulated({ summary: { ...SUMMARY, missingCount: 30 } }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Arquivar os 30 produtos ausentes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }));

    const box = await screen.findByRole('alertdialog');
    expect(box).toHaveTextContent('digite o número 30');
    const confirm = within(box).getByRole('button', { name: 'Confirmar arquivamento' });
    await userEvent.type(within(box).getByLabelText('Digite 30 para confirmar'), '29');
    expect(confirm).toBeDisabled();
    await userEvent.clear(within(box).getByLabelText('Digite 30 para confirmar'));
    await userEvent.type(within(box).getByLabelText('Digite 30 para confirmar'), '30');
    await userEvent.click(confirm);

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(applying, false));
    expect((api.post as Mock).mock.calls[0][1]).toEqual({ archiveMissing: true });
    expect((api.post as Mock).mock.calls[1][1]).toEqual({ archiveMissing: true, confirmArchiveCount: 30 });
  });

  it('IMPORT_IN_PROGRESS mostra a mensagem e reabilita o botão', async () => {
    (api.post as Mock).mockRejectedValue(
      new ApiError(409, 'Já existe outra importação em andamento.', { errorCode: 'IMPORT_IN_PROGRESS' }),
    );
    const { onConfirmed } = renderStep();
    const button = screen.getByRole('button', { name: 'Confirmar importação' });
    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe outra importação em andamento.');
    expect(button).toBeEnabled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

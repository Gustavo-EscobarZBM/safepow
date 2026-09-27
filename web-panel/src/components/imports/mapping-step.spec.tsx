import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MappingStep } from './mapping-step';
import { api, ApiError } from '@/lib/api-client';
import type { ImportJob, PreviewResult } from '@/lib/imports';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { post: vi.fn() },
}));

const FIELDS = [
  { key: 'barcode', label: 'Código de barras', required: true, updatable: false },
  { key: 'name', label: 'Nome', required: true, updatable: true },
  { key: 'sku', label: 'SKU', required: false, updatable: true },
  { key: 'unitPrice', label: 'Preço de venda', required: false, updatable: true },
  { key: 'costPrice', label: 'Custo', required: false, updatable: true },
];

function preview(overrides: Partial<PreviewResult> = {}): PreviewResult {
  return {
    headers: ['EAN', 'Descrição', 'Preço', 'Custo'],
    sample: [['789', 'Arroz', '10,00', '7,00']],
    suggestedMapping: { barcode: 'EAN', name: 'Descrição', unitPrice: 'Preço', costPrice: 'Custo' },
    matchedMapping: null,
    fields: FIELDS,
    ...overrides,
  };
}

const JOB = { id: 'j1', status: 'uploaded', sheetName: 'Produtos' } as ImportJob;

function renderStep(props: Partial<Parameters<typeof MappingStep>[0]> = {}) {
  const onPreviewChange = vi.fn();
  const onSimulated = vi.fn();
  render(
    <MappingStep
      job={JOB}
      preview={preview()}
      sheets={['Produtos']}
      onPreviewChange={onPreviewChange}
      onSimulated={onSimulated}
      {...props}
    />,
  );
  return { onPreviewChange, onSimulated };
}

describe('MappingStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pré-seleciona a sugestão do backend', () => {
    renderStep();
    expect(screen.getByLabelText('Código de barras *')).toHaveValue('EAN');
    expect(screen.getByLabelText('Nome *')).toHaveValue('Descrição');
    expect(screen.getByLabelText('SKU')).toHaveValue('');
  });

  it('avisa quando reconheceu um mapeamento salvo', () => {
    renderStep({ preview: preview({ matchedMapping: { id: 'm1', name: 'ERP Loja' } }) });
    expect(screen.getByText('Mapeamento salvo reconhecido: ERP Loja')).toBeInTheDocument();
  });

  it('seletor de aba só aparece com mais de uma aba; trocar aba pede nova prévia', async () => {
    const next = preview({ headers: ['Codigo', 'Nome'], suggestedMapping: { barcode: 'Codigo', name: 'Nome' } });
    (api.post as Mock).mockResolvedValue(next);
    const { onPreviewChange } = renderStep({ sheets: ['Produtos', 'Outra'] });
    await userEvent.selectOptions(screen.getByLabelText('Aba da planilha'), 'Outra');
    await waitFor(() => expect(onPreviewChange).toHaveBeenCalledWith(next));
    expect(api.post).toHaveBeenCalledWith('imports/j1/preview', { sheetName: 'Outra' });
  });

  it('sem aba extra, não mostra o seletor', () => {
    renderStep();
    expect(screen.queryByLabelText('Aba da planilha')).not.toBeInTheDocument();
  });

  it('simular sem Nome ⇒ mensagem e nenhuma chamada', async () => {
    renderStep();
    await userEvent.selectOptions(screen.getByLabelText('Nome *'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Simular importação' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha a coluna de Código de barras e de Nome.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('mesma coluna em dois campos ⇒ mensagem', async () => {
    renderStep();
    await userEvent.selectOptions(screen.getByLabelText('SKU'), 'EAN');
    await userEvent.click(screen.getByRole('button', { name: 'Simular importação' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A coluna EAN foi escolhida para dois campos.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('simula com os campos mapeados, os campos a atualizar e o nome do mapeamento', async () => {
    const simulated = { ...JOB, status: 'simulating' };
    (api.post as Mock).mockResolvedValue({ job: simulated });
    const { onSimulated } = renderStep();
    await userEvent.type(screen.getByLabelText('Salvar este mapeamento como (opcional)'), 'ERP Loja');
    await userEvent.click(screen.getByRole('button', { name: 'Simular importação' }));
    await waitFor(() => expect(onSimulated).toHaveBeenCalledWith(simulated));
    expect(api.post).toHaveBeenCalledWith('imports/j1/simulate', {
      sheetName: 'Produtos',
      mapping: { barcode: 'EAN', name: 'Descrição', unitPrice: 'Preço', costPrice: 'Custo' },
      updateFields: ['name', 'unitPrice', 'costPrice'],
      saveMappingAs: 'ERP Loja',
    });
  });

  it('desmarcar "Custo" tira costPrice dos campos a atualizar', async () => {
    (api.post as Mock).mockResolvedValue({ job: JOB });
    renderStep();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Custo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Simular importação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((api.post as Mock).mock.calls[0][1]).toMatchObject({ updateFields: ['name', 'unitPrice'] });
    expect((api.post as Mock).mock.calls[0][1]).not.toHaveProperty('saveMappingAs');
  });

  it('campo desmapeado some da lista de atualização', async () => {
    renderStep();
    expect(screen.getByRole('checkbox', { name: 'Custo' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Custo' }), '');
    expect(screen.queryByRole('checkbox', { name: 'Custo' })).not.toBeInTheDocument();
  });

  it('erro do backend aparece na tela', async () => {
    (api.post as Mock).mockRejectedValue(new ApiError(400, 'A coluna "Preço" não existe na planilha.'));
    renderStep();
    await userEvent.click(screen.getByRole('button', { name: 'Simular importação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A coluna "Preço" não existe na planilha.');
  });

  it('amostra fica num contêiner com rolagem horizontal', () => {
    renderStep();
    const scroll = screen.getByTestId('sample-scroll');
    expect(scroll).toHaveClass('overflow-x-auto');
    expect(scroll).toHaveTextContent('Arroz');
  });
});

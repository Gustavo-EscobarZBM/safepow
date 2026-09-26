import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RetroFixDialog } from './retro-fix-dialog';
import { api, ApiError } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const PRODUCT = { id: 'p-a', name: 'Arroz 5kg', unitPrice: '12.00', costPrice: '8.00' };
const IMPACT = { affectedLosses: 2, currentTotal: 6, newTotal: 60, currentCostTotal: 4, newCostTotal: 40 };
const FROM = new Date(2026, 8, 1, 0, 0, 0, 0).toISOString();
const TO = new Date(2026, 8, 20, 23, 59, 59, 999).toISOString();

async function fillPeriodAndPreview() {
  await userEvent.type(screen.getByLabelText('De'), '2026-09-01');
  await userEvent.type(screen.getByLabelText('Até'), '2026-09-20');
  await userEvent.click(screen.getByRole('button', { name: 'Ver impacto' }));
}

function renderDialog(onApplied = vi.fn()) {
  render(<RetroFixDialog product={PRODUCT} open onOpenChange={() => {}} onApplied={onApplied} />);
  return onApplied;
}

describe('RetroFixDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prévia com o período do dia inteiro e os valores atuais do produto', async () => {
    (api.get as Mock).mockResolvedValue(IMPACT);
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Corrigir valores de perdas passadas' })).toBeInTheDocument();

    await fillPeriodAndPreview();

    const query = new URLSearchParams(((api.get as Mock).mock.calls[0][0] as string).split('?')[1]);
    expect((api.get as Mock).mock.calls[0][0]).toMatch(/^products\/p-a\/retro-fix\/preview\?/);
    expect(Object.fromEntries(query)).toEqual({ from: FROM, to: TO, unitPrice: '12', costPrice: '8' });
    expect(await screen.findByText(/2 perdas: R\$\s?6,00 → R\$\s?60,00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar correção' })).toBeDisabled();
  });

  it('aplica com a justificativa e avisa o resultado', async () => {
    (api.get as Mock).mockResolvedValue(IMPACT);
    (api.post as Mock).mockResolvedValue(IMPACT);
    const onApplied = renderDialog();
    await fillPeriodAndPreview();
    await screen.findByText(/2 perdas/);

    await userEvent.type(screen.getByLabelText('Justificativa'), 'Preço digitado errado');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar correção' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('products/p-a/retro-fix', {
        from: FROM,
        to: TO,
        unitPrice: 12,
        costPrice: 8,
        justification: 'Preço digitado errado',
      }),
    );
    expect(onApplied).toHaveBeenCalledWith('applied', IMPACT);
  });

  it('resposta pendente (202) ⇒ onApplied("pending")', async () => {
    (api.get as Mock).mockResolvedValue(IMPACT);
    (api.post as Mock).mockResolvedValue({ status: 'pending', changeRequestId: 'c1', policy: 'retro_fix' });
    const onApplied = renderDialog();
    await fillPeriodAndPreview();
    await screen.findByText(/2 perdas/);
    await userEvent.type(screen.getByLabelText('Justificativa'), 'Preço digitado errado');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar correção' }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('pending', undefined));
  });

  it('período sem perdas não deixa aplicar', async () => {
    (api.get as Mock).mockResolvedValue({ ...IMPACT, affectedLosses: 0, currentTotal: 0, newTotal: 0 });
    renderDialog();
    await fillPeriodAndPreview();

    expect(await screen.findByText('Nenhuma perda no período.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Justificativa'), 'Preço digitado errado');
    expect(screen.getByRole('button', { name: 'Aplicar correção' })).toBeDisabled();
  });

  it('mudar o preço depois da prévia exige ver o impacto de novo', async () => {
    (api.get as Mock).mockResolvedValue(IMPACT);
    renderDialog();
    await fillPeriodAndPreview();
    await screen.findByText(/2 perdas/);
    await userEvent.type(screen.getByLabelText('Justificativa'), 'Preço digitado errado');
    expect(screen.getByRole('button', { name: 'Aplicar correção' })).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Preço unitário (R$)'), '5');

    expect(screen.getByRole('button', { name: 'Aplicar correção' })).toBeDisabled();
    expect(screen.queryByText(/2 perdas/)).not.toBeInTheDocument();
  });

  it('erro da API aparece no diálogo', async () => {
    (api.get as Mock).mockRejectedValue(new ApiError(400, 'A janela máxima é de 366 dias por correção.'));
    renderDialog();
    await fillPeriodAndPreview();

    expect(await screen.findByText('A janela máxima é de 366 dias por correção.')).toBeInTheDocument();
  });
});

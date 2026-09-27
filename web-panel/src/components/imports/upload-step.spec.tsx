import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadStep } from './upload-step';
import { api, ApiError } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { postForm: vi.fn(), getBlob: vi.fn() },
}));

const file = () => new File(['a'], 'produtos.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

describe('UploadStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia o arquivo com resource=products e avisa quem chamou', async () => {
    const result = { job: { id: 'j1' }, headers: [] };
    (api.postForm as Mock).mockResolvedValue(result);
    const onUploaded = vi.fn();
    render(<UploadStep onUploaded={onUploaded} />);

    const send = screen.getByRole('button', { name: 'Enviar planilha' });
    expect(send).toBeDisabled();
    await userEvent.upload(screen.getByLabelText('Planilha (.xlsx ou .csv)'), file());
    await userEvent.click(send);

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(result));
    const [path, form] = (api.postForm as Mock).mock.calls[0] as [string, FormData];
    expect(path).toBe('imports');
    expect((form.get('file') as File).name).toBe('produtos.xlsx');
    expect(form.get('resource')).toBe('products');
  });

  it('erro do backend aparece na tela', async () => {
    (api.postForm as Mock).mockRejectedValue(new ApiError(400, 'Formato de arquivo não suportado.'));
    render(<UploadStep onUploaded={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Planilha (.xlsx ou .csv)'), file());
    await userEvent.click(screen.getByRole('button', { name: 'Enviar planilha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato de arquivo não suportado.');
  });

  it('"Baixar modelo" busca o modelo de produtos', async () => {
    (api.getBlob as Mock).mockResolvedValue(new Blob(['x']));
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(window.URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<UploadStep onUploaded={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Baixar modelo' }));
    await waitFor(() => expect(api.getBlob).toHaveBeenCalledWith('imports/template?resource=products'));
    await waitFor(() => expect(click).toHaveBeenCalled());
    click.mockRestore();
  });
});

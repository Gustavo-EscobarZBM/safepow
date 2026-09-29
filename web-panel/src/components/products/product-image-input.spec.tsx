import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '@/lib/api-client';
import { resizeImage } from '@/lib/resize-image';
import { ProductImageInput } from './product-image-input';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn(), getBlob: vi.fn() },
}));
vi.mock('@/lib/resize-image', () => ({ resizeImage: vi.fn() }));

describe('ProductImageInput (SP4 4.1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reduz, envia para uploads/product-image e devolve a URL', async () => {
    (resizeImage as Mock).mockResolvedValue(new Blob(['small'], { type: 'image/jpeg' }));
    (api.postForm as Mock).mockResolvedValue({ url: 'https://cdn/p.jpg' });
    const onChange = vi.fn();
    render(<ProductImageInput value={null} onChange={onChange} />);

    await userEvent.upload(screen.getByLabelText('Foto do produto'), new File(['big'], 'foto.png', { type: 'image/png' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/p.jpg'));
    expect((api.postForm as Mock).mock.calls[0][0]).toBe('uploads/product-image');
  });

  it('imagem que não dá para ler mostra a mensagem e não chama a API', async () => {
    (resizeImage as Mock).mockRejectedValue(new Error('Não foi possível ler esta imagem. Use JPEG, PNG ou WebP.'));
    render(<ProductImageInput value={null} onChange={vi.fn()} />);
    // applyAccept: false — simula o arquivo chegando mesmo assim (ex.: "Todos os arquivos" no seletor do sistema).
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Foto do produto'), new File(['x'], 'foto.heic', { type: 'image/heic' }));
    expect(await screen.findByText('Não foi possível ler esta imagem. Use JPEG, PNG ou WebP.')).toBeInTheDocument();
    expect(api.postForm).not.toHaveBeenCalled();
  });

  it('com foto: mostra a prévia e "Remover foto" limpa', async () => {
    const onChange = vi.fn();
    render(<ProductImageInput value="https://cdn/p.jpg" onChange={onChange} />);
    expect(screen.getByRole('img', { name: 'Foto do produto' })).toHaveAttribute('src', 'https://cdn/p.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Remover foto' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizeImage, targetSize } from './resize-image';

describe('targetSize (SP4 4.1)', () => {
  it('reduz o lado maior para 800 mantendo a proporção', () => {
    expect(targetSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(targetSize(900, 1800)).toEqual({ width: 400, height: 800 });
  });

  it('não aumenta imagem pequena', () => {
    expect(targetSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
});

describe('resizeImage (SP4 4.1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('desenha no tamanho reduzido e devolve JPEG 0,85', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })));
    const drawImage = vi.fn();
    const toBlob = vi.fn((done: (blob: Blob) => void, type: string) => done(new Blob(['jpeg'], { type })));
    const calls: string[] = [];
    const context = {
      fillStyle: '',
      fillRect: vi.fn(() => calls.push(`fill ${context.fillStyle}`)),
      drawImage: vi.fn((...args: unknown[]) => { calls.push('draw'); drawImage(...args); }),
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob };
    vi.spyOn(document, 'createElement').mockReturnValueOnce(canvas as unknown as HTMLCanvasElement);

    const blob = await resizeImage(new File(['x'], 'foto.png', { type: 'image/png' }));
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
    expect(blob.type).toBe('image/jpeg');
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    // PNG transparente (foto de fabricante) vira JPEG com fundo branco, não preto.
    expect(calls).toEqual(['fill #ffffff', 'draw']);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it('imagem que o navegador não lê (ex.: HEIC) vira mensagem amigável', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new Error('decode'))));
    await expect(resizeImage(new File(['x'], 'foto.heic', { type: 'image/heic' }))).rejects.toThrow(
      'Não foi possível ler esta imagem. Use JPEG, PNG ou WebP.',
    );
  });
});

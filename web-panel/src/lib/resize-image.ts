/** Lado maior da foto do produto depois de reduzida (SP4 4.1): leve para o app baixar e nítida na tela. */
export const PRODUCT_IMAGE_MAX_SIDE = 800;
const JPEG_QUALITY = 0.85;
const UNREADABLE = 'Não foi possível ler esta imagem. Use JPEG, PNG ou WebP.';

export function targetSize(width: number, height: number, maxSide = PRODUCT_IMAGE_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Reduz a foto no próprio navegador (sem dependência nova) e devolve JPEG. Uma foto de celular de 5–12 MB vira
 * poucas centenas de KB antes do envio. Formato que o navegador não decodifica (HEIC fora do Safari) é recusado.
 */
export async function resizeImage(file: File, maxSide = PRODUCT_IMAGE_MAX_SIDE): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  const { width, height } = targetSize(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(UNREADABLE);
  // JPEG não tem transparência: sem o fundo branco, o PNG recortado do fabricante sairia com fundo preto.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE))), 'image/jpeg', JPEG_QUALITY),
  );
}

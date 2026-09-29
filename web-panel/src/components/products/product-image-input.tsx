'use client';

import { useId, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { resizeImage } from '@/lib/resize-image';
import { Button } from '@/components/ui/button';

interface ProductImageInputProps {
  value: string | null;
  onChange: (url: string | null) => void;
}

/**
 * Foto do produto (SP4 4.1): reduz no navegador, envia para `uploads/product-image` e devolve a URL. O produto só
 * guarda a URL ao salvar o formulário; desistir da foto não impede salvar o resto.
 */
export function ProductImageInput({ value, onChange }: ProductImageInputProps) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const resized = await resizeImage(file);
      const form = new FormData();
      form.append('file', resized, file.name.replace(/\.[^.]+$/, '') + '.jpg');
      const { url } = await api.postForm<{ url: string }>('uploads/product-image', form);
      onChange(url);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Não foi possível enviar a foto.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Foto do produto" className="size-16 rounded-md border object-cover" />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-md border border-dashed text-muted-foreground">
            <ImagePlus className="size-5" aria-hidden />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            {busy ? 'Enviando...' : value ? 'Trocar foto' : 'Enviar foto'}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Foto do produto"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {value && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
              <Trash2 className="size-3.5" />
              Remover foto
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

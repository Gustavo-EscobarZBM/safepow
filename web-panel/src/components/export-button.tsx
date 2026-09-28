'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { downloadBlob } from '@/lib/imports';

type ExportFormat = 'xlsx' | 'csv';

const OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: 'xlsx', label: 'Excel (.xlsx)' },
  { format: 'csv', label: 'CSV (.csv)' },
];

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface ExportButtonProps {
  /** Rota de exportação do backend, ex.: `products/export`. */
  path: string;
  /** Início do nome do arquivo baixado: `<fileBase>-AAAA-MM-DD.<formato>`. */
  fileBase: string;
  /** Filtros atuais da tela; valores vazios não vão na URL. */
  params?: Record<string, string | undefined>;
}

/** Botão "Exportar" com menu Excel/CSV (SP3, 3.3): baixa o arquivo gerado em streaming pelo backend. */
export function ExportButton({ path, fileBase, params = {} }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function download(format: ExportFormat) {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams({ format });
      for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
      downloadBlob(await api.getBlob(`${path}?${query.toString()}`), `${fileBase}-${today()}.${format}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao exportar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={container} className="relative inline-flex flex-col items-end gap-1">
      <Button variant="outline" onClick={() => setOpen((v) => !v)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
        <Download className="size-4" aria-hidden />
        {busy ? 'Gerando…' : 'Exportar'}
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-40 rounded-md border bg-popover p-1 shadow-md">
          {OPTIONS.map((option) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              onClick={() => download(option.format)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

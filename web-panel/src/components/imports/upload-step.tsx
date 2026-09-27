'use client';

import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';
import { downloadBlob, type UploadResult } from '@/lib/imports';

/** Passo "Arquivo" do assistente de importação (SP3): envia a planilha e devolve a prévia. */
export function UploadStep({ onUploaded }: { onUploaded: (result: UploadResult) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('resource', 'products');
      onUploaded(await api.postForm<UploadResult>('imports', form));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao enviar a planilha.');
    } finally {
      setSending(false);
    }
  }

  async function downloadTemplate() {
    setDownloading(true);
    setError(null);
    try {
      downloadBlob(await api.getBlob('imports/template?resource=products'), 'modelo-importacao-produtos.xlsx');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao baixar o modelo.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Envie a planilha de produtos (.xlsx ou .csv). Nada é gravado agora: primeiro você confere as colunas e vê uma
        simulação do que vai mudar.
      </p>
      <div className="space-y-2">
        <Label htmlFor="import-file">Planilha (.xlsx ou .csv)</Label>
        <Input
          id="import-file"
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={send} disabled={!file || sending}>
          <Upload className="size-4" aria-hidden />
          {sending ? 'Enviando…' : 'Enviar planilha'}
        </Button>
        <Button variant="outline" onClick={downloadTemplate} disabled={downloading}>
          <Download className="size-4" aria-hidden />
          Baixar modelo
        </Button>
      </div>
    </div>
  );
}

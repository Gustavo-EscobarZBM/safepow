'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { downloadBlob, type ImportJob } from '@/lib/imports';

interface ResultStepProps {
  job: ImportJob;
  onJobChange: (job: ImportJob) => void;
  onAdjustColumns: () => void;
}

const LINK_BUTTON =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted';

/** Passo "Resultado" (SP3): gravação em andamento, aguardando aprovação, concluída, falhou ou cancelada. */
export function ResultStep({ job, onJobChange, onAdjustColumns }: ResultStepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = job.summary?.counts;

  async function post(action: 'retry' | 'cancel') {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ job: ImportJob }>(`imports/${job.id}/${action}`);
      onJobChange(result.job);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao atualizar a importação.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport() {
    try {
      const base = job.fileName.replace(/\.[^.]+$/, '');
      downloadBlob(await api.getBlob(`imports/${job.id}/report.csv`), `relatorio-${base}.csv`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao baixar o relatório.');
    }
  }

  const cancelButton = (
    <Button variant="outline" onClick={() => post('cancel')} disabled={busy}>
      <X className="size-4" aria-hidden />
      Cancelar importação
    </Button>
  );
  const newImport = (
    <Link href="/cadastros/importacoes/nova" className={LINK_BUTTON}>
      Nova importação
    </Link>
  );
  const reportButton = job.errorReportKey ? (
    <Button variant="outline" onClick={downloadReport}>
      <Download className="size-4" aria-hidden />
      Baixar relatório (CSV)
    </Button>
  ) : null;

  let body: React.ReactNode;
  if (job.status === 'applying') {
    const total = counts ? counts.create + counts.update + counts.reactivate + counts.unchanged : 0;
    const done = Math.min(job.summary?.appliedCount ?? 0, total);
    const percent = total > 0 ? Math.round((done * 100) / total) : 0;
    body = (
      <div className="space-y-2">
        <p className="text-sm">
          Gravando: {done} de {total} linhas
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  } else if (job.status === 'pending_approval') {
    body = (
      <div className="space-y-3">
        <p className="text-sm">Aguardando aprovação de outro gerente.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/aprovacoes" className={LINK_BUTTON}>
            Ver pedidos
          </Link>
          {cancelButton}
        </div>
      </div>
    );
  } else if (job.status === 'completed') {
    const archived = job.options?.archiveMissing ? (job.summary?.missingCount ?? 0) : 0;
    const items: [string, number][] = counts
      ? [
          ['Criados', counts.create],
          ['Atualizados', counts.update],
          ['Reativados', counts.reactivate],
          ['Sem mudança', counts.unchanged],
          ['Arquivados', archived],
          ['Erros', counts.error],
        ]
      : [];
    body = (
      <div className="space-y-4">
        <p className="text-sm font-medium">Importação concluída.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {items.map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/cadastros/produtos" className={LINK_BUTTON}>
            Ver produtos
          </Link>
          {newImport}
          {reportButton}
        </div>
      </div>
    );
  } else if (job.status === 'failed') {
    const applyFailed = !!job.options?.applyStartedAt;
    body = (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{job.lastError ?? 'A importação falhou.'}</p>
        <div className="flex flex-wrap gap-2">
          {applyFailed ? (
            <>
              <Button onClick={() => post('retry')} disabled={busy}>
                <RotateCcw className="size-4" aria-hidden />
                Tentar de novo
              </Button>
              {cancelButton}
            </>
          ) : (
            <Button onClick={onAdjustColumns}>Ajustar colunas</Button>
          )}
        </div>
      </div>
    );
  } else {
    // cancelled (e estados da reversão, que ganham tela própria na 3.4)
    body = (
      <div className="space-y-3">
        <p className="text-sm">{job.lastError ?? 'Importação cancelada.'}</p>
        <div className="flex flex-wrap gap-2">{newImport}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {body}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

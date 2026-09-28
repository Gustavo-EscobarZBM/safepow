'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, RotateCcw, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { canRollback, downloadBlob, type ImportJob } from '@/lib/imports';
import { PENDING_APPROVAL_NOTICE } from '@/lib/approvals';
import { RollbackDialog } from './rollback-dialog';
import { SimulationStep } from './simulation-step';

interface ResultStepProps {
  job: ImportJob;
  /** Quem vê a tela: só o autor cancela a importação que aguarda aprovação. */
  currentUserId: string;
  onJobChange: (job: ImportJob) => void;
  onAdjustColumns: () => void;
}

/** Igual ao backend: reversão sem progresso há mais que isto pode ser pedida de novo. */
const STUCK_ROLLBACK_MS = 5 * 60 * 1000;

const LINK_BUTTON =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted';

/** Passo "Resultado" (SP3): gravação em andamento, aguardando aprovação, concluída, falhou, cancelada ou revertida. */
export function ResultStep({ job, currentUserId, onJobChange, onAdjustColumns }: ResultStepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const counts = job.summary?.counts;

  async function post(action: 'retry' | 'cancel' | 'rollback') {
    setBusy(true);
    setError(null);
    try {
      const result =
        action === 'rollback'
          ? await api.post<{ job: ImportJob }>(`imports/${job.id}/rollback`, {})
          : await api.post<{ job: ImportJob }>(`imports/${job.id}/${action}`);
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
  // <a> e não <Link>: depois do upload a URL vira /importacoes/:id por history.replaceState, mas a árvore do Next
  // continua sendo a de /nova — um <Link> para /nova reaproveitaria o assistente com o job anterior.
  const newImport = (
    <a href="/cadastros/importacoes/nova" className={LINK_BUTTON}>
      Nova importação
    </a>
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
    const mine = !!job.createdByUserId && job.createdByUserId === currentUserId;
    body = (
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm">
            {mine
              ? 'Aguardando aprovação de outro gerente.'
              : 'Esta importação aguarda aprovação. Decida o pedido na fila de aprovações.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/aprovacoes" className={LINK_BUTTON}>
              Ver pedidos
            </Link>
            {mine && cancelButton}
          </div>
        </div>
        <SimulationStep job={job} readOnly onBack={() => undefined} onConfirmed={() => undefined} />
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
        {job.lastError && (
          <p className="text-sm text-destructive">A última tentativa de reverter falhou: {job.lastError}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/cadastros/produtos" className={LINK_BUTTON}>
            Ver produtos
          </Link>
          {newImport}
          {reportButton}
          {canRollback(job) && (
            <Button variant="outline" onClick={() => setRollbackOpen(true)}>
              <Undo2 className="size-4" aria-hidden />
              Reverter importação
            </Button>
          )}
        </div>
        {rollbackOpen && (
          <RollbackDialog
            job={job}
            open={rollbackOpen}
            onOpenChange={setRollbackOpen}
            onStarted={(next, pending) => {
              setRollbackOpen(false);
              setNotice(pending ? PENDING_APPROVAL_NOTICE : null);
              onJobChange(next);
            }}
          />
        )}
      </div>
    );
  } else if (job.status === 'rolling_back') {
    const requestedAt = Date.parse(job.options?.rollbackRequestedAt ?? '');
    const stuck = requestedAt < Date.now() - STUCK_ROLLBACK_MS;
    body = (
      <div className="space-y-3 py-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Revertendo a importação…
        </div>
        {stuck && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">A reversão parece parada há mais de 5 minutos.</p>
            <Button variant="outline" size="sm" onClick={() => post('rollback')} disabled={busy}>
              <RotateCcw className="size-4" aria-hidden />
              Tentar de novo
            </Button>
          </div>
        )}
      </div>
    );
  } else if (job.status === 'rolled_back') {
    const items: [string, number][] = [
      ['Desfeitas', job.summary?.rolledBackCount ?? 0],
      ['Mantidas (mudaram depois)', job.summary?.conflictCount ?? 0],
    ];
    body = (
      <div className="space-y-4">
        <p className="text-sm font-medium">Importação revertida.</p>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
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
    // cancelled (e status antigos pending/processing)
    body = (
      <div className="space-y-3">
        <p className="text-sm">{job.lastError ?? 'Importação cancelada.'}</p>
        <div className="flex flex-wrap gap-2">{newImport}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice && <p className="rounded-md border px-3 py-2 text-sm">{notice}</p>}
      {body}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pagination } from '@/components/pagination';
import { useApprovalFlow } from '@/hooks/use-approval-flow';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTimeBR } from '@/lib/format';
import type { ImportJob, RollbackPreview } from '@/lib/imports';

const PAGE_SIZE = 20;
const REASON_LABELS = { changed: 'Alterado depois', deleted: 'Excluído' } as const;

type RollbackResponse = { job: ImportJob } | { status: 'pending'; changeRequestId: string; job: ImportJob };

interface RollbackDialogProps {
  job: ImportJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (job: ImportJob, pending: boolean) => void;
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/**
 * Reverter importação (SP3, 3.4): prévia (o que volta e o que fica por ter mudado depois), confirmação com
 * justificativa/aprovação do SP2 quando a política pede.
 */
export function RollbackDialog({ job, open, onOpenChange, onStarted }: RollbackDialogProps) {
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<RollbackPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const latestRequest = useRef(0);
  const approval = useApprovalFlow();

  useEffect(() => {
    if (!open) return;
    const requestId = ++latestRequest.current;
    api
      .get<RollbackPreview>(`imports/${job.id}/rollback-preview?page=${page}&limit=${PAGE_SIZE}`)
      .then((data) => {
        if (latestRequest.current !== requestId) return;
        setPreview(data);
        setPreviewError(null);
      })
      .catch((e) => {
        if (latestRequest.current !== requestId) return;
        setPreviewError(e instanceof ApiError ? e.message : 'Erro ao carregar a prévia da reversão.');
      });
  }, [open, job.id, page]);

  async function confirm() {
    setSending(true);
    setError(null);
    let response: RollbackResponse | null = null;
    try {
      await approval.execute(
        async (justification) => {
          response = await api.post<RollbackResponse>(`imports/${job.id}/rollback`, justification ? { justification } : {});
          return response;
        },
        (outcome) => {
          if (response) onStarted(response.job, outcome === 'pending');
        },
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao reverter a importação.');
    } finally {
      setSending(false);
    }
  }

  const totalPages = preview ? Math.max(1, Math.ceil(preview.total / PAGE_SIZE)) : 1;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reverter importação</DialogTitle>
            <DialogDescription>
              Os produtos voltam a como estavam antes de {job.fileName}. Quem mudou depois da importação fica como está.
            </DialogDescription>
          </DialogHeader>

          {previewError && (
            <p role="alert" className="text-sm text-destructive">
              {previewError}
            </p>
          )}
          {!preview && !previewError && <p className="text-sm text-muted-foreground">Calculando a prévia…</p>}
          {preview && (
            <div className="space-y-3 text-sm">
              <p>
                {preview.restore} {plural(preview.restore, 'alteração será desfeita.', 'alterações serão desfeitas.')}
              </p>
              {preview.conflicts > 0 && (
                <>
                  <p>
                    {preview.conflicts}{' '}
                    {plural(
                      preview.conflicts,
                      'produto mudou depois da importação e fica como está.',
                      'produtos mudaram depois da importação e ficam como estão.',
                    )}
                  </p>
                  <div className="max-w-full overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">Código</th>
                          <th className="px-3 py-2 font-medium">Produto</th>
                          <th className="px-3 py-2 font-medium">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.items.map((item) => (
                          <tr key={`${item.key}-${item.appliedAction}`} className="border-t">
                            <td className="px-3 py-1.5 font-mono text-xs">{item.key}</td>
                            <td className="px-3 py-1.5">{item.name ?? '—'}</td>
                            <td className="px-3 py-1.5">{REASON_LABELS[item.reason]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination page={page} totalPages={totalPages} onChange={setPage} />
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">Pode ser revertida até {formatDateTimeBR(preview.expiresAt)}.</p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Fechar
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={sending || !preview || !!previewError}>
              <Undo2 className="size-4" aria-hidden />
              Reverter importação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {approval.dialog}
    </>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/pagination';
import { useApprovalFlow } from '@/hooks/use-approval-flow';
import { api, ApiError } from '@/lib/api-client';
import {
  ACTION_LABELS,
  WARNING_LABELS,
  describeDiff,
  downloadBlob,
  type ImportJob,
  type ImportRowView,
  type MissingItem,
  type Page,
} from '@/lib/imports';

const PAGE_SIZE = 20;

const FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'create', label: 'Criar' },
  { value: 'update', label: 'Atualizar' },
  { value: 'reactivate', label: 'Reativar' },
  { value: 'unchanged', label: 'Sem mudança' },
  { value: 'error', label: 'Erros' },
  { value: 'warnings', label: 'Avisos' },
  { value: 'duplicate', label: 'Repetidas' },
];

type ApplyResponse = { job: ImportJob } | { status: 'pending'; changeRequestId: string; job: ImportJob };

interface SimulationStepProps {
  job: ImportJob;
  onBack: () => void;
  onConfirmed: (job: ImportJob, pending: boolean) => void;
  /** Cancelamento da simulação travada. */
  onJobChange?: (job: ImportJob) => void;
  /** Só leitura (importação aguardando aprovação): sem confirmar nem voltar às colunas. */
  readOnly?: boolean;
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/** Passo "Simulação" (SP3): o que a planilha vai mudar, e a confirmação (com justificativa/aprovação do SP2). */
export function SimulationStep({ job, onBack, onConfirmed, onJobChange, readOnly = false }: SimulationStepProps) {
  const summary = job.summary;
  const ready = (readOnly || job.status === 'simulated') && !!summary;

  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Page<ImportRowView> | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const [missing, setMissing] = useState<Page<MissingItem> | null>(null);
  const [missingPage, setMissingPage] = useState(1);
  const [showMissing, setShowMissing] = useState(false);

  const [archiveMissing, setArchiveMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<{
    message: string;
    count: number;
  } | null>(null);
  const [typedCount, setTypedCount] = useState('');
  const [downloading, setDownloading] = useState(false);
  const approval = useApprovalFlow();

  useEffect(() => {
    if (!ready) return;
    const requestId = ++latestRequest.current;
    const query = new URLSearchParams();
    if (filter !== 'all') query.set('action', filter);
    query.set('page', String(page));
    query.set('limit', String(PAGE_SIZE));
    api
      .get<Page<ImportRowView>>(`imports/${job.id}/rows?${query.toString()}`)
      .then((data) => {
        if (latestRequest.current !== requestId) return;
        setRows(data);
        setRowsError(null);
      })
      .catch((e) => {
        if (latestRequest.current !== requestId) return;
        setRowsError(e instanceof ApiError ? e.message : 'Erro ao carregar as linhas.');
      });
  }, [ready, job.id, filter, page]);

  useEffect(() => {
    if (!showMissing) return;
    let active = true;
    api
      .get<Page<MissingItem>>(`imports/${job.id}/missing?page=${missingPage}&limit=${PAGE_SIZE}`)
      .then((data) => active && setMissing(data))
      .catch(() => active && setMissing({ items: [], total: 0 }));
    return () => {
      active = false;
    };
  }, [showMissing, missingPage, job.id]);

  async function cancel() {
    setConfirming(true);
    setError(null);
    try {
      const result = await api.post<{ job: ImportJob }>(`imports/${job.id}/cancel`);
      onJobChange?.(result.job);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao cancelar a importação.');
    } finally {
      setConfirming(false);
    }
  }

  if (!ready) {
    // Sem saída aqui, uma simulação travada (worker/Redis fora) prenderia a tela e a empresa (IMPORT_IN_PROGRESS).
    return (
      <div className="space-y-4 py-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Simulando a planilha…
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={cancel} disabled={confirming}>
          Cancelar importação
        </Button>
      </div>
    );
  }

  const counts = summary.counts;
  const warningTotal = Object.values(summary.warnings).reduce((sum, n) => sum + n, 0);
  const missingCount = summary.missingCount;
  const cards: [string, number][] = [
    ['Criar', counts.create],
    ['Atualizar', counts.update],
    ['Reativar', counts.reactivate],
    ['Sem mudança', counts.unchanged],
    ['Erros', counts.error],
    ['Repetidas', counts.duplicate],
    ['Avisos', warningTotal],
  ];

  async function send(extra: { confirmArchiveCount?: number } = {}) {
    setConfirming(true);
    setError(null);
    let response: ApplyResponse | null = null;
    try {
      await approval.execute(
        async (justification) => {
          const body: Record<string, unknown> = { archiveMissing, ...extra };
          if (justification) body.justification = justification;
          response = await api.post<ApplyResponse>(`imports/${job.id}/apply`, body);
          return response;
        },
        (outcome) => {
          setArchiveConfirm(null);
          if (response) onConfirmed(response.job, outcome === 'pending');
        },
      );
    } catch (e) {
      if (e instanceof ApiError && e.errorCode === 'ARCHIVE_CONFIRMATION_REQUIRED') {
        const count = Number((e.data as { missingCount?: unknown })?.missingCount ?? missingCount);
        setTypedCount('');
        setArchiveConfirm({ message: e.message, count });
      } else {
        setError(e instanceof ApiError ? e.message : 'Erro ao confirmar a importação.');
      }
    } finally {
      setConfirming(false);
    }
  }

  async function downloadReport() {
    setDownloading(true);
    try {
      const base = job.fileName.replace(/\.[^.]+$/, '');
      downloadBlob(await api.getBlob(`imports/${job.id}/report.csv`), `relatorio-${base}.csv`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao baixar o relatório.');
    } finally {
      setDownloading(false);
    }
  }

  const totalPages = rows ? Math.max(1, Math.ceil(rows.total / PAGE_SIZE)) : 1;
  const missingPages = missing ? Math.max(1, Math.ceil(missing.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div data-testid="summary-cards" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {warningTotal > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {Object.entries(summary.warnings).map(([code, n]) => (
            <li key={code}>{`${WARNING_LABELS[code] ?? code}: ${n}`}</li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <div className="max-w-full overflow-x-auto">
          <Tabs
            value={filter}
            onValueChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
          >
            <TabsList>
              {FILTERS.map((f) => (
                <TabsTrigger key={f.value} value={f.value}>
                  {f.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {rowsError && (
          <p role="alert" className="text-sm text-destructive">
            {rowsError}
          </p>
        )}
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Linha</th>
                <th className="px-3 py-2 font-medium">Código</th>
                <th className="px-3 py-2 font-medium">Ação</th>
                <th className="px-3 py-2 font-medium">Mudanças</th>
                <th className="px-3 py-2 font-medium">Erros/avisos</th>
              </tr>
            </thead>
            <tbody>
              {rows?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Nenhuma linha neste filtro.
                  </td>
                </tr>
              )}
              {rows?.items.map((row) => (
                <tr key={`${row.rowNumber}-${row.key}`} className="border-t align-top">
                  <td className="px-3 py-2 tabular-nums">{row.rowNumber}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.key ?? '—'}</td>
                  <td className="px-3 py-2">{ACTION_LABELS[row.action]}</td>
                  <td className="px-3 py-2">
                    {describeDiff(row.diff).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    {row.errors.map((message) => (
                      <div key={message} className="text-destructive">
                        {message}
                      </div>
                    ))}
                    {row.warnings.map((code) => (
                      <div key={code} className="text-amber-700 dark:text-amber-400">
                        {WARNING_LABELS[code] ?? code}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </section>

      {missingCount > 0 && (
        <section className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {missingCount}{' '}
              {plural(missingCount, 'produto ativo não está na planilha', 'produtos ativos não estão na planilha')}
            </p>
            <Button variant="outline" size="sm" onClick={() => setShowMissing((v) => !v)}>
              {showMissing ? 'Esconder lista' : 'Ver lista'}
            </Button>
          </div>
          {showMissing && missing && (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {missing.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="py-1.5 pr-3">{item.name}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{item.key}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{item.hasLosses ? 'tem perdas' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={missingPage} totalPages={missingPages} onChange={setMissingPage} />
            </div>
          )}
        </section>
      )}

      {!readOnly && (
        <section className="space-y-4 rounded-lg border p-4">
          {missingCount > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="archive-missing"
                checked={archiveMissing}
                disabled={confirming || !!archiveConfirm}
                onCheckedChange={(checked) => setArchiveMissing(checked === true)}
              />
              <Label htmlFor="archive-missing" className="font-normal">
                {missingCount === 1 ? 'Arquivar o produto ausente' : `Arquivar os ${missingCount} produtos ausentes`}
              </Label>
            </div>
          )}

          {archiveConfirm && (
            <div
              role="alertdialog"
              aria-labelledby="archive-confirm-text"
              className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
            >
              <p id="archive-confirm-text" className="text-sm">
                {archiveConfirm.message}
              </p>
              <div className="max-w-xs space-y-1">
                <Label htmlFor="archive-confirm-count">Digite {archiveConfirm.count} para confirmar</Label>
                <Input
                  id="archive-confirm-count"
                  inputMode="numeric"
                  value={typedCount}
                  onChange={(e) => setTypedCount(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={confirming || typedCount.trim() !== String(archiveConfirm.count)}
                  onClick={() => send({ confirmArchiveCount: archiveConfirm.count })}
                >
                  Confirmar arquivamento
                </Button>
                <Button variant="outline" onClick={() => setArchiveConfirm(null)} disabled={confirming}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send()} disabled={confirming || !!archiveConfirm}>
              <Check className="size-4" aria-hidden />
              Confirmar importação
            </Button>
            <Button variant="outline" onClick={onBack} disabled={confirming}>
              <ArrowLeft className="size-4" aria-hidden />
              Voltar e ajustar colunas
            </Button>
            {job.errorReportKey && (
              <Button variant="outline" onClick={downloadReport} disabled={downloading}>
                <Download className="size-4" aria-hidden />
                Baixar relatório (CSV)
              </Button>
            )}
          </div>
        </section>
      )}
      {approval.dialog}
    </div>
  );
}

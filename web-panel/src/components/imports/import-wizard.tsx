'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';
import { PENDING_APPROVAL_NOTICE } from '@/lib/approvals';
import { formatDateShortBR } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isPolling, stepForJob, type ImportJob, type PreviewResult, type UploadResult } from '@/lib/imports';
import { UploadStep } from './upload-step';
import { MappingStep } from './mapping-step';
import { SimulationStep } from './simulation-step';
import { ResultStep } from './result-step';

const POLL_MS = 2000;

const STEPS = [
  { key: 'upload', label: 'Arquivo' },
  { key: 'columns', label: 'Colunas' },
  { key: 'simulation', label: 'Simulação' },
  { key: 'result', label: 'Resultado' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

function duplicateNotice(duplicate: NonNullable<UploadResult['duplicateOf']>): string {
  const when = duplicate.appliedAt ? ` em ${formatDateShortBR(duplicate.appliedAt)}` : '';
  const who = duplicate.createdByName ? ` por ${duplicate.createdByName}` : '';
  return `Esta planilha já foi importada${when}${who}.`;
}

/**
 * Assistente de importação (SP3, 3.2): o passo sai do status do job — a fonte da verdade é o backend, então recarregar
 * a página retoma no passo certo. Consulta o job a cada 2 s enquanto simula, grava ou reverte.
 */
export function ImportWizard({ jobId }: { jobId?: string }) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState<UploadResult['duplicateOf']>(null);
  const [editingColumns, setEditingColumns] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    api
      .get<ImportJob>(`imports/${jobId}`)
      .then((loaded) => {
        if (!active) return;
        setJob(loaded);
        setSheets(loaded.sheets ?? []);
      })
      .catch((e) => active && setLoadError(e instanceof ApiError ? e.message : 'Erro ao carregar a importação.'));
    return () => {
      active = false;
    };
  }, [jobId]);

  const polling = !!job && isPolling(job.status);
  useEffect(() => {
    if (!job || !polling) return;
    let active = true;
    const timer = setInterval(() => {
      api
        .get<ImportJob>(`imports/${job.id}`)
        .then((next) => active && setJob(next))
        .catch(() => undefined); // falha passageira: tenta de novo no próximo ciclo
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, polling]); // eslint-disable-line react-hooks/exhaustive-deps

  const step: StepKey = !job ? 'upload' : editingColumns ? 'columns' : stepForJob(job);

  // Colunas sem prévia em memória (F5, ou voltando da simulação) ⇒ pede a prévia da aba atual.
  useEffect(() => {
    if (!job || step !== 'columns' || preview) return;
    let active = true;
    api
      .post<PreviewResult>(`imports/${job.id}/preview`, job.sheetName ? { sheetName: job.sheetName } : {})
      .then((loaded) => active && setPreview(loaded))
      .catch((e) => active && setLoadError(e instanceof ApiError ? e.message : 'Erro ao ler a planilha.'));
    return () => {
      active = false;
    };
  }, [job?.id, job?.sheetName, step, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  // Voltando para ajustar, as colunas começam pelo mapeamento já usado (e não pela sugestão).
  const mappingPreview = useMemo(() => {
    if (!preview) return null;
    if (!job?.mapping) return preview;
    const usable = Object.fromEntries(Object.entries(job.mapping).filter(([, header]) => preview.headers.includes(header)));
    return { ...preview, suggestedMapping: usable };
  }, [preview, job?.mapping]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleUploaded(result: UploadResult) {
    const { job: uploaded, sheets: uploadedSheets, duplicateOf, ...rest } = result;
    setPreview(rest);
    setSheets(uploadedSheets);
    setDuplicate(duplicateOf);
    setJob(uploaded);
    window.history.replaceState(null, '', `/cadastros/importacoes/${uploaded.id}`);
  }

  const current = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground" aria-hidden>·</span>}
            <span
              aria-current={i === current ? 'step' : undefined}
              className={cn(
                i === current ? 'font-semibold text-foreground' : i < current ? 'text-foreground/70' : 'text-muted-foreground',
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {duplicate && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{duplicateNotice(duplicate)}</p>
      )}
      {notice && <p className="rounded-md border px-3 py-2 text-sm">{notice}</p>}
      {step === 'columns' && job?.status === 'failed' && job.lastError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {job.lastError}
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          {step === 'upload' && !jobId && <UploadStep onUploaded={handleUploaded} />}
          {step === 'columns' && job && mappingPreview && (
            <MappingStep
              job={job}
              preview={mappingPreview}
              sheets={sheets}
              onPreviewChange={(next) => setPreview(next)}
              onSimulated={(next) => {
                setEditingColumns(false);
                setDuplicate(null);
                setJob(next);
              }}
            />
          )}
          {step === 'simulation' && job && (
            <SimulationStep
              job={job}
              onBack={() => setEditingColumns(true)}
              onConfirmed={(next, pending) => {
                setNotice(pending ? PENDING_APPROVAL_NOTICE : null);
                setJob(next);
              }}
            />
          )}
          {step === 'result' && job && (
            <ResultStep job={job} onJobChange={setJob} onAdjustColumns={() => setEditingColumns(true)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

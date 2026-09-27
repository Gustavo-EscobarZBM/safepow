'use client';

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';
import type { ImportJob, PreviewResult } from '@/lib/imports';

const SELECT_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30';
const SAMPLE_ROWS = 20;

interface MappingStepProps {
  job: ImportJob;
  preview: PreviewResult;
  sheets: string[];
  onPreviewChange: (preview: PreviewResult) => void;
  onSimulated: (job: ImportJob) => void;
}

/** Passo "Colunas" (SP3): liga cada campo a uma coluna da planilha e pede a simulação. */
export function MappingStep({ job, preview, sheets, onPreviewChange, onSimulated }: MappingStepProps) {
  const [sheetName, setSheetName] = useState(job.sheetName ?? sheets[0] ?? '');
  const [mapping, setMapping] = useState<Record<string, string>>(preview.suggestedMapping);
  const [skipUpdate, setSkipUpdate] = useState<Set<string>>(new Set());
  const [saveAs, setSaveAs] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nova prévia (troca de aba) ⇒ recomeça pela sugestão dela.
  useEffect(() => {
    setMapping(preview.suggestedMapping);
    setSkipUpdate(new Set());
  }, [preview]);

  const fieldLabel = (key: string) => preview.fields.find((f) => f.key === key)?.label ?? key;
  const updatable = preview.fields.filter((f) => f.updatable && mapping[f.key]);

  async function changeSheet(next: string) {
    setSheetName(next);
    setBusy(true);
    setError(null);
    try {
      onPreviewChange(await api.post<PreviewResult>(`imports/${job.id}/preview`, { sheetName: next }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao ler a aba.');
    } finally {
      setBusy(false);
    }
  }

  function validate(): string | null {
    if (preview.fields.some((f) => f.required && !mapping[f.key])) return 'Escolha a coluna de Código de barras e de Nome.';
    const seen = new Set<string>();
    for (const header of Object.values(mapping)) {
      if (!header) continue;
      if (seen.has(header)) return `A coluna ${header} foi escolhida para dois campos.`;
      seen.add(header);
    }
    return null;
  }

  async function simulate() {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const chosen = Object.fromEntries(Object.entries(mapping).filter(([, header]) => header));
      const body: Record<string, unknown> = {
        sheetName: sheetName || undefined,
        mapping: chosen,
        updateFields: updatable.filter((f) => !skipUpdate.has(f.key)).map((f) => f.key),
      };
      if (saveAs.trim()) body.saveMappingAs = saveAs.trim();
      const result = await api.post<{ job: ImportJob }>(`imports/${job.id}/simulate`, body);
      onSimulated(result.job);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao simular a importação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {sheets.length > 1 && (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="import-sheet">Aba da planilha</Label>
          <select
            id="import-sheet"
            className={SELECT_CLASS}
            value={sheetName}
            disabled={busy}
            onChange={(e) => changeSheet(e.target.value)}
          >
            {sheets.map((sheet) => (
              <option key={sheet} value={sheet}>
                {sheet}
              </option>
            ))}
          </select>
        </div>
      )}

      {preview.matchedMapping && (
        <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          Mapeamento salvo reconhecido: {preview.matchedMapping.name}
        </p>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Qual coluna da planilha corresponde a cada campo?</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {preview.fields.map((field) => (
            <div key={field.key} className="min-w-0 space-y-1">
              <Label htmlFor={`map-${field.key}`}>{field.required ? `${field.label} *` : field.label}</Label>
              <select
                id={`map-${field.key}`}
                className={SELECT_CLASS}
                value={mapping[field.key] ?? ''}
                onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
              >
                <option value="">— não importar —</option>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {updatable.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Atualizar em produtos que já existem</h3>
          <p className="text-xs text-muted-foreground">
            Campos desmarcados só são usados em produtos novos; os que já existem ficam como estão.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {updatable.map((field) => (
              <div key={field.key} className="flex items-center gap-2">
                <Checkbox
                  id={`update-${field.key}`}
                  checked={!skipUpdate.has(field.key)}
                  onCheckedChange={(checked) => {
                    const next = new Set(skipUpdate);
                    if (checked) next.delete(field.key);
                    else next.add(field.key);
                    setSkipUpdate(next);
                  }}
                />
                <Label htmlFor={`update-${field.key}`} className="font-normal">
                  {fieldLabel(field.key)}
                </Label>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Amostra da planilha</h3>
        <div data-testid="sample-scroll" className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-max min-w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {preview.headers.map((header) => (
                  <th key={header} className="max-w-[16rem] truncate px-3 py-2 text-left font-medium" title={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.slice(0, SAMPLE_ROWS).map((row, i) => (
                <tr key={i} className="border-t">
                  {preview.headers.map((header, j) => (
                    <td key={header} className="max-w-[16rem] truncate px-3 py-1.5" title={row[j] ?? ''}>
                      {row[j] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="max-w-sm space-y-1">
        <Label htmlFor="import-save-as">Salvar este mapeamento como (opcional)</Label>
        <Input
          id="import-save-as"
          maxLength={80}
          placeholder="Ex.: Planilha do ERP"
          value={saveAs}
          onChange={(e) => setSaveAs(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button onClick={simulate} disabled={busy}>
        <Play className="size-4" aria-hidden />
        Simular importação
      </Button>
    </div>
  );
}

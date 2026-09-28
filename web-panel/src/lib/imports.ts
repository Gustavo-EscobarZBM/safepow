import { formatBRL } from '@/lib/format';

/** Importação 2.0 (SP3): tipos e rótulos do assistente e do histórico. */

export type ImportJobStatus =
  | 'pending'
  | 'processing'
  | 'uploaded'
  | 'simulating'
  | 'simulated'
  | 'pending_approval'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolling_back'
  | 'rolled_back';

export type RowAction = 'create' | 'update' | 'reactivate' | 'unchanged' | 'error' | 'duplicate' | 'archive';

export interface ImportOptions {
  updateFields: string[];
  archiveMissing?: boolean;
  confirmArchiveCount?: number;
  applyStartedAt?: string;
}

export interface ImportSummary {
  totalRows: number;
  counts: Record<RowAction, number>;
  warnings: Record<string, number>;
  missingCount: number;
  sensitive: { priceChange: number; archiveWithHistory: number };
  appliedCount?: number;
  rolledBackCount?: number;
  conflictCount?: number;
  rowsPurged?: boolean;
}

export interface ImportRowError {
  row: number;
  error: string;
}

export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  resource: string;
  fileName: string;
  format: 'xlsx' | 'csv' | null;
  sheetName: string | null;
  sheets: string[] | null;
  headers: string[] | null;
  mapping: Record<string, string> | null;
  options: ImportOptions | null;
  summary: ImportSummary | null;
  errorReport: ImportRowError[] | null;
  errorReportKey: string | null;
  createdByUserId: string | null;
  changeRequestId: string | null;
  simulatedAt: string | null;
  appliedAt: string | null;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
  totalRows: number | null;
  successCount: number;
  errorCount: number;
}

export type ImportListItem = ImportJob & { createdByName: string | null };

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  updatable: boolean;
}

export interface PreviewResult {
  headers: string[];
  sample: (string | null)[][];
  suggestedMapping: Record<string, string>;
  matchedMapping: { id: string; name: string } | null;
  fields: ImportField[];
}

export interface UploadResult extends PreviewResult {
  job: ImportJob;
  sheets: string[];
  duplicateOf: { jobId: string; fileName: string; appliedAt: string | null; createdByName: string | null } | null;
}

export type ImportDiff = Record<string, { from: unknown; to: unknown }>;

export interface ImportRowView {
  rowNumber: number;
  key: string | null;
  action: RowAction;
  normalized: Record<string, unknown> | null;
  diff: ImportDiff | null;
  warnings: string[];
  errors: string[];
  raw: Record<string, string | null> | null;
}

export interface MissingItem {
  id: string;
  key: string;
  name: string;
  hasLosses: boolean;
}

export interface RollbackConflict {
  key: string;
  name: string | null;
  appliedAction: RowAction;
  reason: 'changed' | 'deleted';
}

/** GET imports/:id/rollback-preview */
export interface RollbackPreview {
  restore: number;
  conflicts: number;
  items: RollbackConflict[];
  total: number;
  expiresAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export const IMPORT_STATUS_LABELS: Record<ImportJobStatus, string> = {
  pending: 'Processando',
  processing: 'Processando',
  uploaded: 'Arquivo enviado',
  simulating: 'Simulando',
  simulated: 'Simulada',
  pending_approval: 'Aguardando aprovação',
  applying: 'Gravando',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  rolling_back: 'Revertendo',
  rolled_back: 'Revertida',
};

export const ACTION_LABELS: Record<RowAction, string> = {
  create: 'Criar',
  update: 'Atualizar',
  reactivate: 'Reativar',
  unchanged: 'Sem mudança',
  error: 'Erro',
  duplicate: 'Repetida',
  archive: 'Arquivar',
};

/** Mesmos textos de backend/src/modules/imports/engine/report-csv.ts. */
export const WARNING_LABELS: Record<string, string> = {
  GTIN_LENGTH_SUSPECT: 'Tamanho de código suspeito (zero à esquerda perdido?)',
  GTIN_CHECK_DIGIT: 'Dígito verificador inválido',
  AMBIGUOUS_DECIMAL: 'Separador decimal ambíguo',
  PRICE_ROUNDED: 'Valor arredondado para 2 casas',
  NAME_TRUNCATED: 'Nome cortado em 200 caracteres',
  PRICE_JUMP: 'Variação de preço de 50% ou mais',
  COST_ABOVE_PRICE: 'Custo maior que o preço',
  DUPLICATE_IDENTICAL: 'Linha repetida (ignorada)',
};

const FIELD_LABELS: Record<string, string> = {
  barcode: 'Código de barras',
  name: 'Nome',
  sku: 'SKU',
  unitPrice: 'Preço de venda',
  costPrice: 'Custo',
};
const PRICE_FIELDS = ['unitPrice', 'costPrice'];

export type WizardStep = 'columns' | 'simulation' | 'result';

/** Passo do assistente derivado do status do job (a fonte da verdade é o backend: F5 retoma no passo certo). */
export function stepForJob(job: Pick<ImportJob, 'status' | 'options'>): WizardStep {
  switch (job.status) {
    case 'uploaded':
      return 'columns';
    case 'simulating':
    case 'simulated':
      return 'simulation';
    case 'failed':
      return job.options?.applyStartedAt ? 'result' : 'columns';
    default:
      return 'result';
  }
}

/** Dias em que uma importação concluída ainda pode ser revertida (spec I7). */
export const ROLLBACK_WINDOW_DAYS = 30;

/** Concluída, gravada há até 30 dias e com as linhas de preparação guardadas (o backend confere de novo). */
export function canRollback(job: Pick<ImportJob, 'status' | 'appliedAt' | 'summary'>, now: Date = new Date()): boolean {
  if (job.status !== 'completed' || !job.appliedAt || job.summary?.rowsPurged) return false;
  return now.getTime() - new Date(job.appliedAt).getTime() <= ROLLBACK_WINDOW_DAYS * 24 * 3600 * 1000;
}

export function isPolling(status: ImportJobStatus): boolean {
  return status === 'simulating' || status === 'applying' || status === 'rolling_back';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (PRICE_FIELDS.includes(field)) return formatBRL(Number(value));
  return String(value);
}

/** "Preço de venda: R$ 10,00 → R$ 12,00"; reativação vira "Reativar". */
export function describeDiff(diff: ImportDiff | null | undefined): string[] {
  if (!diff) return [];
  const lines: string[] = [];
  if (diff.isActive) lines.push('Reativar');
  for (const [field, change] of Object.entries(diff)) {
    if (field === 'isActive') continue;
    lines.push(`${FIELD_LABELS[field] ?? field}: ${formatValue(field, change.from)} → ${formatValue(field, change.to)}`);
  }
  return lines;
}

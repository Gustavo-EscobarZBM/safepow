import { formatBRL, formatDateTimeBR } from './format';
import type { AuditChange, AuditLogEntry } from './types';

/**
 * Mapa único de rótulos da auditoria (SP2, 2.1.2). Página Auditoria e gaveta Histórico leem daqui; o motor
 * de cadastros (2.4) também. Chave desconhecida (coluna nova no backend) aparece crua em vez de quebrar.
 */
export const ENTITY_LABELS: Record<string, string> = {
  product: 'Produto',
  loss_reason: 'Motivo',
  loss_location: 'Local',
  loss: 'Perda',
  user: 'Usuário',
  company: 'Empresa',
  company_revenue: 'Faturamento',
  import_job: 'Importação',
  session: 'Acesso',
  change_request: 'Solicitação',
};

export const ACTION_LABELS: Record<string, string> = {
  create: 'Criação',
  update: 'Alteração',
  archive: 'Arquivamento',
  restore: 'Reativação',
  delete: 'Exclusão',
  import: 'Importação',
  login: 'Login',
  login_failed: 'Falha de login',
  approve: 'Aprovação',
  reject: 'Rejeição',
  retro_fix: 'Correção retroativa',
  request: 'Solicitação',
  justify: 'Justificativa',
};

export const SOURCE_LABELS: Record<string, string> = {
  web: 'Painel',
  mobile: 'App',
  import: 'Importação',
  system: 'Sistema',
};

export const ROLE_LABELS: Record<string, string> = {
  manager: 'Gerente',
  employee: 'Funcionário',
  master_admin: 'Administrador Master',
};

const COMPANY_STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  past_due: 'Vencida',
  blocked: 'Bloqueada',
  canceled: 'Cancelada',
};

export const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  barcode: 'Código de barras',
  sku: 'SKU',
  unitPrice: 'Preço unitário',
  costPrice: 'Custo',
  isActive: 'Ativo',
  quantity: 'Quantidade',
  description: 'Descrição',
  productId: 'Produto',
  reasonId: 'Motivo',
  locationId: 'Local',
  occurredAt: 'Data da perda',
  imageUrl: 'Foto',
  requiresVerification: 'Exige conferência',
  verifiedAt: 'Conferida em',
  verifiedByUserId: 'Conferida por',
  reportedByUserId: 'Registrada por',
  unitPriceAtLoss: 'Preço na data da perda',
  unitCostAtLoss: 'Custo na data da perda',
  valuationSource: 'Origem do valor',
  clientGeneratedId: 'Identificador do app',
  source: 'Origem',
  email: 'E-mail',
  role: 'Papel',
  password: 'Senha',
  cnpj: 'CNPJ',
  status: 'Situação',
  planTier: 'Plano',
  lastManualUnlockAt: 'Desbloqueio manual',
  lossVerificationEnabled: 'Conferência de perdas',
  lossVerifierId: 'Conferente',
  year: 'Ano',
  month: 'Mês',
  revenueAmount: 'Faturamento',
};

const MONEY_FIELDS = new Set(['unitPrice', 'costPrice', 'unitPriceAtLoss', 'unitCostAtLoss', 'revenueAmount']);
const DATE_FIELDS = new Set(['occurredAt', 'verifiedAt', 'lastManualUnlockAt']);
// Referências a outro registro: o id cru não diz nada a quem lê; a linha diz só que mudou.
const REFERENCE_FIELDS = new Set([
  'productId',
  'reasonId',
  'locationId',
  'verifiedByUserId',
  'reportedByUserId',
  'lossVerifierId',
  'clientGeneratedId',
  'imageUrl',
]);

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (MONEY_FIELDS.has(field) && !Number.isNaN(Number(value))) return formatBRL(Number(value));
  if (DATE_FIELDS.has(field) && typeof value === 'string') return formatDateTimeBR(value);
  if (field === 'role') return ROLE_LABELS[String(value)] ?? String(value);
  if (field === 'status') return COMPANY_STATUS_LABELS[String(value)] ?? String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function describeChange(change: AuditChange, action: string): string {
  const label = fieldLabel(change.field);
  if (change.field === 'password') return 'Senha alterada';
  if (REFERENCE_FIELDS.has(change.field)) return `${label}: alterado`;
  if (action === 'create') return `${label}: ${formatAuditValue(change.field, change.to)}`;
  if (action === 'delete') return `${label}: ${formatAuditValue(change.field, change.from)}`;
  return `${label}: ${formatAuditValue(change.field, change.from)} → ${formatAuditValue(change.field, change.to)}`;
}

function describeImportSummary(summary: Record<string, unknown>): string {
  const n = (key: string) => Number(summary[key] ?? 0);
  const counts = `${n('created')} criado(s), ${n('updated')} atualizado(s), ${n('reactivated')} reativado(s), ${n('errors')} com erro`;
  if (summary.status === 'failed') return `Falhou — ${counts}`;
  return `${n('totalRows')} linhas: ${counts}`;
}

/** Linhas legíveis de um registro: uma por alteração, ou o resumo da importação. Vazio para login. */
/** Data sem hora, dd/mm/aaaa (período da correção retroativa). */
export function formatDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function describeRetroFixSummary(summary: Record<string, unknown>): string {
  const count = Number(summary.affectedLosses ?? 0);
  return `${count} ${count === 1 ? 'perda' : 'perdas'} de ${formatDateBR(String(summary.from))} a ${formatDateBR(
    String(summary.to),
  )} corrigidas: ${formatBRL(Number(summary.currentTotal ?? 0))} → ${formatBRL(Number(summary.newTotal ?? 0))}`;
}

export function describeEntry(entry: AuditLogEntry): string[] {
  if (entry.summary && entry.entityType === 'import_job') return [describeImportSummary(entry.summary)];
  if (entry.summary && entry.action === 'retro_fix') return [describeRetroFixSummary(entry.summary)];
  return entry.changes.map((change) => describeChange(change, entry.action));
}

export interface AuditFilters {
  entityType?: string;
  action?: string;
  /** yyyy-mm-dd (input type="date"); vira o início do dia no fuso do navegador. */
  from?: string;
  /** yyyy-mm-dd; vira o FIM do dia no fuso do navegador — o backend compara `createdAt <= to`. */
  to?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

export function localDayBoundary(date: string, endOfDay: boolean): string {
  const [year, month, day] = date.split('-').map(Number);
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
    : new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

export function buildAuditQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.action) params.set('action', filters.action);
  if (filters.entityId) params.set('entityId', filters.entityId);
  if (filters.from) params.set('from', localDayBoundary(filters.from, false));
  if (filters.to) params.set('to', localDayBoundary(filters.to, true));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();
  return query ? `?${query}` : '';
}

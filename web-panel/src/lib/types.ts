export type UserRole = 'master_admin' | 'manager' | 'employee';

export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
  companyId: string | null;
  /** Funcionário designado como conferente de descarte pelo gerente (vem do login do backend). */
  isLossVerifier?: boolean;
}

export interface Product {
  id: string;
  barcode: string;
  sku: string | null;
  name: string;
  unitPrice: string | number;
  costPrice: string | number;
  isActive: boolean;
}

/** Origem de uma mudança de preço (backend: product_price_history.source). */
export type PriceChangeSource = 'manual' | 'import' | 'bulk' | 'retro_fix' | 'erp' | 'approval' | 'backfill';

/** Linha de GET /products/:id/price-history (mais recente primeiro, no máximo 100). */
export interface PriceHistoryEntry {
  id: string;
  unitPrice: number;
  costPrice: number;
  validFrom: string;
  source: PriceChangeSource;
  changedByUserId: string | null;
  changedByName: string | null;
}

/** Filtro de status da busca de produtos (backend: GET /products/search?status=). */
export type ProductStatusFilter = 'active' | 'archived' | 'all';

/** Resposta de GET /products/search. */
export interface ProductSearchResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateProductInput {
  barcode?: string;
  sku?: string;
  name?: string;
  unitPrice?: number;
  costPrice?: number;
}

// Motivo/Local da perda deixaram de ser listas fixas — agora são catálogos
// que o Gerente cadastra/exclui em Cadastros > Motivo/Local da Perda.
export interface LossReasonOption {
  id: string;
  name: string;
}

export interface LossLocationOption {
  id: string;
  name: string;
}

export type LossSource = 'mobile' | 'web';

export interface Loss {
  id: string;
  clientGeneratedId: string;
  productId: string;
  quantity: string | number;
  locationId: string;
  reasonId: string;
  description: string | null;
  imageUrl: string | null;
  occurredAt: string;
  source: LossSource | null;
  product?: Product;
  reportedBy?: { id: string; name: string };
  reason?: LossReasonOption;
  location?: LossLocationOption;
}

export interface LossByProductReportRow {
  productId: string;
  productName: string;
  totalQuantity: string;
  totalFinancialLoss: string;
  totalCostLoss: string;
}

export interface LossSummaryReport {
  currentMonth: { totalQuantity: number; totalFinancialLoss: number; totalCostLoss: number };
  previousMonth: { totalQuantity: number; totalFinancialLoss: number; totalCostLoss: number };
  financialVariationPercent: number | null;
  costVariationPercent: number | null;
  projectedMonthEnd: {
    totalQuantity: number;
    totalFinancialLoss: number;
    totalCostLoss: number;
    financialVariationPercent: number | null;
  };
  shrinkageRate: number | null;
}

export interface CompanyMonthlyRevenue {
  id: string;
  year: number;
  month: number;
  revenueAmount: string | number;
}

export interface SuspiciousPatternEntry {
  employeeId: string;
  employeeName: string;
  score: number;
  reasons: string[];
}

export interface CompanySettings {
  lossVerificationEnabled: boolean;
  lossVerifierId: string | null;
}

export interface LossByPeriodRow {
  date: string;
  totalQuantity: string;
  totalFinancialLoss: string;
}

export interface LossByReasonRow {
  id: string;
  label: string;
  totalQuantity: string;
  totalFinancialLoss: string;
}

export interface LossByLocationRow {
  id: string;
  label: string;
  totalQuantity: string;
  totalFinancialLoss: string;
}

export type AlertSeverity = 'critical' | 'warning' | 'success' | 'info';

export interface LossAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
}

export type CompanyStatus = 'trial' | 'active' | 'past_due' | 'blocked' | 'canceled';

export interface Company {
  id: string;
  name: string;
  cnpj: string | null;
  status: CompanyStatus;
  planTier: string;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImportRowError {
  row: number;
  error: string;
}

export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  fileName: string;
  totalRows: number | null;
  successCount: number;
  errorCount: number;
  errorReport: ImportRowError[] | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

/** Uma alteração de campo registrada pela auditoria (SP2). */
export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** Linha da trilha de auditoria (backend: GET /audit). */
export interface AuditLogEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  action: string;
  changes: AuditChange[];
  summary: Record<string, unknown> | null;
  source: string;
  reason: string | null;
  requestId: string | null;
  ip: string | null;
}

export interface AuditPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** Políticas de aprovação (SP2, 2.2 — backend: GET/PUT /approval-policies). */
export type ApprovalPolicyKey = 'price_change' | 'retro_fix' | 'loss_edit' | 'archive_with_history';
export type ApprovalMode = 'approval' | 'justification';

export interface ApprovalPolicies {
  price_change: { enabled: boolean; thresholdPercent: number };
  retro_fix: { enabled: boolean };
  loss_edit: { enabled: boolean };
  archive_with_history: { enabled: boolean };
}

export interface ApprovalPoliciesState {
  policies: ApprovalPolicies;
  activeManagers: number;
  mode: ApprovalMode;
}

/** Resposta 202 de uma mudança sensível que virou pedido. */
export interface PendingApprovalResult {
  status: 'pending';
  changeRequestId: string;
  policy: ApprovalPolicyKey;
}

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

/** Pedido de aprovação (backend: GET /change-requests). */
export interface ChangeRequest {
  id: string;
  policy: ApprovalPolicyKey;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  operation: string;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  justification: string;
  status: ChangeRequestStatus;
  requestedByUserId: string | null;
  requestedByName: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
}

/** Impacto da correção retroativa de preço (backend: GET /products/:id/retro-fix/preview). */
export interface RetroFixImpact {
  affectedLosses: number;
  currentTotal: number;
  newTotal: number;
  currentCostTotal: number;
  newCostTotal: number;
}

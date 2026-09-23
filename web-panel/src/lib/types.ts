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

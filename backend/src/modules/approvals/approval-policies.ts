/** Políticas de aprovação (SP2, etapa 2.2 — spec seção 3.1). Todas desligadas por padrão. */
export const APPROVAL_POLICY_KEYS = ['price_change', 'retro_fix', 'loss_edit', 'archive_with_history'] as const;
export type ApprovalPolicyKey = (typeof APPROVAL_POLICY_KEYS)[number];

export const DEFAULT_PRICE_THRESHOLD_PERCENT = 20;

export interface ApprovalPolicies {
  price_change: { enabled: boolean; thresholdPercent: number };
  retro_fix: { enabled: boolean };
  loss_edit: { enabled: boolean };
  archive_with_history: { enabled: boolean };
}

export type ApprovalMode = 'approval' | 'justification';

/** Lê o jsonb gravado em companies.approvalPolicies de forma tolerante: o que não for válido fica desligado. */
export function normalizePolicies(raw: unknown): ApprovalPolicies {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, { enabled?: unknown; thresholdPercent?: unknown }>;
  const enabled = (key: ApprovalPolicyKey) => source[key]?.enabled === true;
  const threshold = Number(source.price_change?.thresholdPercent);
  return {
    price_change: {
      enabled: enabled('price_change'),
      thresholdPercent: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_PRICE_THRESHOLD_PERCENT,
    },
    retro_fix: { enabled: enabled('retro_fix') },
    loss_edit: { enabled: enabled('loss_edit') },
    archive_with_history: { enabled: enabled('archive_with_history') },
  };
}

function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

/**
 * "Mais de X%" em relação ao valor anterior, só quando o anterior é > 0 (preencher preço zerado não é
 * sensível). Em centavos inteiros: com ponto flutuante, 10 → 12 dá 20,000000000000004% e viraria sensível.
 */
export function priceChangeExceeds(
  before: { unitPrice: number | string; costPrice: number | string },
  after: { unitPrice?: number; costPrice?: number },
  thresholdPercent: number,
): boolean {
  const exceeds = (previous: number | string, next: number | undefined) => {
    if (next === undefined) return false;
    const previousCents = toCents(previous);
    if (!(previousCents > 0)) return false;
    return Math.abs(toCents(next) - previousCents) * 100 > thresholdPercent * previousCents;
  };
  return exceeds(before.unitPrice, after.unitPrice) || exceeds(before.costPrice, after.costPrice);
}

/** U1: com 2+ gerentes ativos, outro gerente aprova; com 1 (ou nenhum), basta a justificativa. */
export function approvalModeFor(activeManagers: number): ApprovalMode {
  return activeManagers >= 2 ? 'approval' : 'justification';
}

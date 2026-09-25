import { ApiError } from './api-client';
import { describeChange } from './audit';
import type { ApprovalMode, ApprovalPolicyKey, ChangeRequest, PendingApprovalResult } from './types';

/** Rótulos das políticas de aprovação (SP2, 2.2). */
export const POLICY_LABELS: Record<ApprovalPolicyKey, string> = {
  price_change: 'Mudança de preço ou custo acima de X%',
  retro_fix: 'Correção retroativa de preço',
  loss_edit: 'Editar ou excluir perda registrada',
  archive_with_history: 'Arquivar produto que já tem perdas',
};

export const PENDING_APPROVAL_NOTICE = 'Enviado para aprovação de outro gerente.';

/** O modo é decidido pelo backend pelo número de gerentes ativos (2+ ⇒ aprovação). */
export function modeDescription(activeManagers: number): string {
  if (activeManagers >= 2) {
    return `Sua empresa tem ${activeManagers} gerentes ativos: as mudanças sensíveis vão para aprovação de outro gerente.`;
  }
  const managers = activeManagers === 1 ? '1 gerente ativo' : `${activeManagers} gerentes ativos`;
  return `Sua empresa tem ${managers}: as mudanças sensíveis pedirão justificativa.`;
}

/** O 409 JUSTIFICATION_REQUIRED do backend: o painel pede o texto e reenvia a mesma requisição. */
export function justificationRequired(
  error: unknown,
): { policy: ApprovalPolicyKey; mode: ApprovalMode; message: string } | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.errorCode !== 'JUSTIFICATION_REQUIRED') return null;
  const data = (error.data ?? {}) as { policy?: ApprovalPolicyKey; mode?: ApprovalMode };
  return { policy: data.policy ?? 'price_change', mode: data.mode ?? 'justification', message: error.message };
}

export function isPendingApproval(value: unknown): value is PendingApprovalResult {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { status?: unknown }).status === 'pending' &&
    typeof (value as { changeRequestId?: unknown }).changeRequestId === 'string'
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const bothNumeric = a !== null && b !== null && a !== '' && b !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b));
  return bothNumeric ? Number(a) === Number(b) : String(a ?? '') === String(b ?? '');
}

/** "De → para" do pedido: o que muda em relação ao registro no momento do pedido. */
export function describeRequest(request: ChangeRequest): string[] {
  if (request.operation === 'archive') return ['Arquivar o produto'];
  if (request.operation === 'delete') return ['Excluir a perda'];
  return Object.entries(request.payload)
    .filter(([field, to]) => to !== undefined && !sameValue(request.snapshot[field], to))
    .map(([field, to]) => describeChange({ field, from: request.snapshot[field], to }, 'update'));
}

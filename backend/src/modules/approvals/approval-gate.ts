import { ConflictException } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { recordAuditEvent } from '../audit/audit-events';
import { ApprovalPolicies, ApprovalPolicyKey, approvalModeFor, normalizePolicies } from './approval-policies';

export interface PendingApproval {
  status: 'pending';
  changeRequestId: string;
  policy: ApprovalPolicyKey;
}

export function isPendingApproval(value: unknown): value is PendingApproval {
  return !!value && typeof value === 'object' && (value as { status?: unknown }).status === 'pending'
    && typeof (value as { changeRequestId?: unknown }).changeRequestId === 'string';
}

/** `skipPolicy`: só a aprovação de um pedido usa — reaplica pelo mesmo método sem pedir aprovação de novo. */
export interface GateOptions {
  skipPolicy?: boolean;
}

export interface GateInput {
  policy: ApprovalPolicyKey;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  operation: 'update' | 'archive' | 'delete' | 'retro_fix';
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  justification?: string;
}

export async function loadCompanyPolicies(): Promise<ApprovalPolicies> {
  const { companyId } = getTenantContext();
  const rows: { approvalPolicies: unknown }[] = await getTenantManager().query(
    `SELECT "approvalPolicies" FROM companies WHERE id = $1`,
    [companyId],
  );
  return normalizePolicies(rows[0]?.approvalPolicies);
}

export async function saveCompanyPolicies(policies: ApprovalPolicies): Promise<void> {
  const { companyId } = getTenantContext();
  await getTenantManager().query(`UPDATE companies SET "approvalPolicies" = $1::jsonb WHERE id = $2`, [
    JSON.stringify(policies),
    companyId,
  ]);
}

/** Gerentes ATIVOS da empresa (a RLS de users restringe à empresa da requisição). */
export async function countActiveManagers(): Promise<number> {
  const rows: { n: number }[] = await getTenantManager().query(
    `SELECT count(*)::int AS n FROM users WHERE role = 'manager' AND "isActive" = true`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Portão das mudanças sensíveis (SP2, spec 3.2–3.4). Só é chamado quando a política se aplica.
 * - sem justificativa ⇒ 409 JUSTIFICATION_REQUIRED (o painel pede o texto e reenvia);
 * - modo justificativa (1 gerente) ⇒ define app.audit_reason (vai para a linha do trigger), grava "justify"
 *   e devolve null — quem chamou segue e grava;
 * - modo aprovação (2+) ⇒ cancela o pendente anterior da mesma entidade+política, cria o pedido, grava
 *   "request" e devolve o pendente — quem chamou NÃO grava.
 */
export async function applyApprovalGate(input: GateInput): Promise<PendingApproval | null> {
  const { companyId, userId } = getTenantContext();
  const manager = getTenantManager();
  const mode = approvalModeFor(await countActiveManagers());

  if (!input.justification) {
    throw new ConflictException({
      statusCode: 409,
      errorCode: 'JUSTIFICATION_REQUIRED',
      message:
        mode === 'approval'
          ? 'Esta mudança precisa da aprovação de outro gerente. Informe a justificativa para enviar o pedido.'
          : 'Esta mudança exige uma justificativa.',
      policy: input.policy,
      mode,
    });
  }

  await manager.query(`SELECT set_config('app.audit_reason', $1, true)`, [input.justification]);

  if (mode === 'justification') {
    await recordAuditEvent(manager, {
      companyId: companyId!,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      action: 'justify',
      summary: { policy: input.policy, operation: input.operation },
    });
    return null;
  }

  await manager.query(
    `UPDATE change_requests
        SET status = 'cancelled', "decidedAt" = now(), "decisionNote" = 'Substituído por um novo pedido.'
      WHERE "entityType" = $1 AND "entityId" = $2 AND policy = $3 AND status = 'pending'`,
    [input.entityType, input.entityId, input.policy],
  );
  const [row]: { id: string }[] = await manager.query(
    `INSERT INTO change_requests
       ("companyId", policy, "entityType", "entityId", "entityLabel", operation, payload, snapshot, justification, "requestedByUserId")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10) RETURNING id`,
    [
      companyId,
      input.policy,
      input.entityType,
      input.entityId,
      input.entityLabel,
      input.operation,
      JSON.stringify(input.payload),
      JSON.stringify(input.snapshot),
      input.justification,
      userId || null,
    ],
  );
  await recordAuditEvent(manager, {
    companyId: companyId!,
    entityType: 'change_request',
    entityId: row.id,
    entityLabel: input.entityLabel,
    action: 'request',
    summary: { policy: input.policy, entityType: input.entityType, entityId: input.entityId, operation: input.operation },
  });
  return { status: 'pending', changeRequestId: row.id, policy: input.policy };
}

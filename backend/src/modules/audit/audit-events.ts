/** Origem de um registro de auditoria (coluna audit_log.source). */
export type AuditSource = 'web' | 'mobile' | 'import' | 'system';

/**
 * O app Flutter usa o cliente HTTP do Dart, que se identifica como "Dart/<versão> (dart:io)". Não exige
 * versão nova do app para saber que a mudança veio do celular.
 */
export function auditSourceFromUserAgent(userAgent: string | undefined): 'web' | 'mobile' {
  return userAgent?.startsWith('Dart/') ? 'mobile' : 'web';
}

export interface AuditEvent {
  companyId: string;
  entityType: string;
  entityId: string | null;
  entityLabel?: string | null;
  action: string;
  changes?: unknown[];
  summary?: Record<string, unknown> | null;
}

/**
 * Registra um evento que não é mudança de linha (login, resumo de importação, decisões de aprovação).
 * Mesma função SQL do trigger (audit_insert): ator, origem, requestId, IP e justificativa vêm das variáveis
 * de sessão da transação de `manager`.
 */
export async function recordAuditEvent(
  manager: { query(sql: string, params?: unknown[]): Promise<unknown> },
  event: AuditEvent,
): Promise<void> {
  await manager.query(`SELECT audit_insert($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`, [
    event.companyId,
    event.entityType,
    event.entityId,
    event.entityLabel ?? null,
    event.action,
    JSON.stringify(event.changes ?? []),
    event.summary ? JSON.stringify(event.summary) : null,
  ]);
}

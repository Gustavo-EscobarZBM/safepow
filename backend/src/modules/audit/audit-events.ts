import { tenantStorage } from '../../common/tenant/tenant-storage';

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

/**
 * Serviços que gravam numa transação própria (outra conexão do pool, ex.: o Painel Master criando empresa)
 * não herdam as variáveis de sessão da transação do middleware — sem isto a auditoria sairia sem autor, como
 * "system". Copia ator, origem, requestId e IP da requisição atual; fora de requisição, não faz nada.
 */
export async function applyRequestAuditContext(manager: {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}): Promise<void> {
  const context = tenantStorage.getStore();
  if (!context) return;
  await manager.query(
    `SELECT set_config('app.current_user_id', $1, true), set_config('app.audit_source', $2, true),
            set_config('app.request_id', $3, true), set_config('app.client_ip', $4, true)`,
    [context.userId, context.audit?.source ?? '', context.audit?.requestId ?? '', context.audit?.ip ?? ''],
  );
}

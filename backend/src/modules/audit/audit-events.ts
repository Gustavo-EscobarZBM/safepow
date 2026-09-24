/** Origem de um registro de auditoria (coluna audit_log.source). */
export type AuditSource = 'web' | 'mobile' | 'import' | 'system';

/**
 * O app Flutter usa o cliente HTTP do Dart, que se identifica como "Dart/<versão> (dart:io)". Não exige
 * versão nova do app para saber que a mudança veio do celular.
 */
export function auditSourceFromUserAgent(userAgent: string | undefined): 'web' | 'mobile' {
  return userAgent?.startsWith('Dart/') ? 'mobile' : 'web';
}

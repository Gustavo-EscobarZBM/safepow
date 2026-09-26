import { AsyncLocalStorage } from 'async_hooks';
import { EntityManager } from 'typeorm';
import { UserRole } from '../../modules/users/user.entity';

/**
 * Contexto de tenant da requisição atual. Populado por TenantContextMiddleware
 * a partir do JWT, e consumido pelos módulos de negócio (products, losses, etc.)
 * para saber "de qual empresa" ler/escrever e para obter um EntityManager cuja
 * conexão já tem `app.current_company_id` definido (o que ativa a política de
 * Row Level Security correspondente no PostgreSQL — ver migration InitialSchema).
 */
export interface TenantContext {
  userId: string;
  role: UserRole;
  companyId: string | null; // null apenas para MASTER_ADMIN
  manager: EntityManager; // manager vinculado à transação/conexão desta requisição
  // Contexto da auditoria (SP2) — o mesmo gravado nas variáveis de sessão da transação acima; guardado aqui
  // para ser copiado para transações próprias (ver applyRequestAuditContext).
  audit?: { source: string; requestId: string; ip: string };
  // Callbacks que o TenantContextMiddleware roda depois do commit bem-sucedido (SP3): enfileirar um job que
  // lê o que esta requisição gravou só pode acontecer depois de a gravação estar visível.
  afterCommit?: Array<() => Promise<void> | void>;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      'Contexto de tenant não encontrado. Esta chamada precisa acontecer dentro ' +
        'de uma requisição HTTP processada pelo TenantContextMiddleware.',
    );
  }
  return ctx;
}

/** Atalho para o EntityManager com RLS já configurado para o tenant da requisição. */
export function getTenantManager(): EntityManager {
  return getTenantContext().manager;
}

/** Agenda `fn` para depois do commit da transação da requisição atual (não roda se ela for desfeita). */
export function afterCommit(fn: () => Promise<void> | void): void {
  const ctx = getTenantContext();
  (ctx.afterCommit ??= []).push(fn);
}

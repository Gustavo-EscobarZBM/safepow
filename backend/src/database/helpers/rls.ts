import { QueryRunner } from 'typeorm';

/**
 * Predicado canônico de isolamento por tenant, para toda política de RLS nova. Usa NULLIF(...) antes
 * do cast ::uuid — a correção do F18 (sub-etapa 1.2.1, migration 1700000010000-RlsReusedConnectionFix):
 * numa conexão do pool reaproveitada sem contexto de tenant, current_setting(..., true) pode devolver
 * '' (texto vazio) em vez de NULL, e o cast ''::uuid lançaria erro em vez de simplesmente não bater com
 * nenhuma linha. NÃO copiar o padrão antigo (current_setting(...)::uuid sem o NULLIF) das migrations
 * anteriores a 1700000010000 — elas ainda estão no disco porque uma migration já aplicada não se edita
 * retroativamente, mas o padrão delas é o que causava o F18.
 */
export const TENANT_COMPANY_ID_PREDICATE =
  `"companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid`;

/**
 * Roda `fn` com FORCE ROW LEVEL SECURITY temporariamente DESLIGADA nas tabelas listadas, dentro da
 * mesma transação da migration, e sempre religa ao final (mesmo se `fn` lançar).
 *
 * Por quê: as migrations deste projeto rodam como DONO das tabelas, mas SEM superusuário (imita banco
 * gerenciado — ver `test-db-lifecycle.ts`, `createTestDatabase`), e todas as tabelas de tenant têm
 * FORCE ROW LEVEL SECURITY — que faz a política valer até para o dono. Um backfill que lê ou grava
 * dados de TODAS as empresas de uma vez (a migration não tem "empresa atual") ficaria bloqueado: a
 * cláusula USING faria um SELECT enxergar zero linhas, e a WITH CHECK faria um INSERT/UPDATE falhar —
 * sem aviso nenhum no primeiro caso, com erro no segundo. NO FORCE (o padrão do Postgres — só quem
 * explicitamente pede FORCE fica sujeito à própria política sendo dono) resolve os dois casos para o
 * dono, sem abrir a tabela para mais ninguém: o role de runtime da aplicação (inventory_saas_app,
 * NUNCA o dono) continua sujeito à RLS o tempo todo, inclusive durante o backfill.
 */
export async function withoutForcedRls(
  queryRunner: QueryRunner,
  tables: string[],
  fn: () => Promise<void>,
): Promise<void> {
  for (const table of tables) {
    await queryRunner.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
  }
  try {
    await fn();
  } finally {
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
  }
}

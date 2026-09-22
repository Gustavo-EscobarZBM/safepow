import { MigrationInterface, QueryRunner } from 'typeorm';

// Tabelas com a política padrão "tenant_isolation_<tabela>" (companyId = ...). "users" é tratada à
// parte logo abaixo, porque tem uma segunda condição para as linhas de MASTER_ADMIN (companyId NULL).
const STANDARD_TABLES = [
  'products',
  'losses',
  'import_jobs',
  'loss_reasons',
  'loss_locations',
  'company_monthly_revenue',
];

/**
 * Corrige o F18 (descoberto na etapa 1.1 — ver rls-isolation.int-spec.ts, teste "conexão reutilizada"):
 * numa conexão do pool que já serviu uma requisição de tenant, current_setting('app.current_company_id',
 * true) passa a devolver '' (texto vazio) em vez de NULL nas transações seguintes que não definem a
 * variável — uma GUC personalizada, uma vez registrada nessa conexão via set_config, nunca mais volta a
 * "não existir"; ela só volta ao valor padrão, que é '', não NULL. O cast ''::uuid das políticas
 * originais lança "invalid input syntax for type uuid" para toda requisição sem tenant (ex.:
 * master_admin) que caia numa conexão reaproveitada, em vez de simplesmente não enxergar nenhuma linha,
 * como pretendido.
 *
 * Correção: NULLIF(current_setting(...), '') normaliza '' para NULL ANTES do cast — daí em diante o
 * comportamento passa a ser idêntico ao de uma conexão nova (current_setting nunca definido).
 */
export class RlsReusedConnectionFix1700000010000 implements MigrationInterface {
  name = 'RlsReusedConnectionFix1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of STANDARD_TABLES) {
      await queryRunner.query(`DROP POLICY "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING ("companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
        WITH CHECK ("companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
      `);
    }

    // users: o ramo "... IS NULL" também precisa do NULLIF, senão '' (não NULL) faz "'' IS NULL" ser
    // falso e as linhas de MASTER_ADMIN (companyId NULL) ficariam invisíveis numa conexão reaproveitada,
    // em vez de continuarem visíveis só para sessões sem tenant (o comportamento pretendido).
    await queryRunner.query(`DROP POLICY "tenant_isolation_users" ON "users"`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_users" ON "users"
      USING (
        "companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        OR ("companyId" IS NULL AND NULLIF(current_setting('app.current_company_id', true), '') IS NULL)
      )
      WITH CHECK (
        "companyId" = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        OR ("companyId" IS NULL AND NULLIF(current_setting('app.current_company_id', true), '') IS NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Melhor esforço: restaura a expressão original (com o bug do F18), mesmo padrão já usado no
    // down() de outras migrations deste projeto — down() existe para desenvolvimento, não para produção.
    for (const table of STANDARD_TABLES) {
      await queryRunner.query(`DROP POLICY "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING ("companyId" = current_setting('app.current_company_id', true)::uuid)
        WITH CHECK ("companyId" = current_setting('app.current_company_id', true)::uuid)
      `);
    }

    await queryRunner.query(`DROP POLICY "tenant_isolation_users" ON "users"`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_users" ON "users"
      USING (
        "companyId" = current_setting('app.current_company_id', true)::uuid
        OR ("companyId" IS NULL AND current_setting('app.current_company_id', true) IS NULL)
      )
      WITH CHECK (
        "companyId" = current_setting('app.current_company_id', true)::uuid
        OR ("companyId" IS NULL AND current_setting('app.current_company_id', true) IS NULL)
      )
    `);
  }
}

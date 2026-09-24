import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE } from '../helpers/rls';

/**
 * Trilha de auditoria (SP2, etapa 2.1). `audit_insert` é o ÚNICO ponto de gravação: lê quem/de onde das
 * variáveis de sessão e grava com a empresa da própria linha auditada — definindo app.current_company_id só
 * durante o INSERT e restaurando o valor anterior —, porque tabelas como "companies" (sem RLS) são escritas
 * fora de contexto de tenant (login, Painel Master, webhook) e a política do audit_log barraria a gravação.
 * Empresa inexistente (sendo excluída em cascata) ⇒ não grava: a linha violaria a FK e derrubaria a exclusão.
 */
export class AuditLog1700000015000 implements MigrationInterface {
  name = 'AuditLog1700000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "seq"         bigint GENERATED ALWAYS AS IDENTITY,
        "companyId"   uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "actorUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "actorName"   varchar(150) NULL,
        "actorRole"   varchar(20) NULL,
        "entityType"  varchar(40) NOT NULL,
        "entityId"    uuid NULL,
        "entityLabel" varchar(200) NULL,
        "action"      varchar(20) NOT NULL CHECK ("action" IN (
                        'create','update','archive','restore','delete','import','login','login_failed',
                        'approve','reject','retro_fix','request','justify')),
        "changes"     jsonb NOT NULL DEFAULT '[]'::jsonb,
        "summary"     jsonb NULL,
        "source"      varchar(20) NOT NULL DEFAULT 'system' CHECK ("source" IN ('web','mobile','import','system')),
        "reason"      text NULL,
        "requestId"   uuid NULL,
        "ip"          inet NULL,
        "createdAt"   timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_company_created" ON "audit_log" ("companyId", "createdAt" DESC, "seq" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_company_entity" ON "audit_log" ("companyId", "entityType", "entityId", "createdAt" DESC)`,
    );

    await queryRunner.query(`ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_audit_log" ON "audit_log"
      USING (${TENANT_COMPANY_ID_PREDICATE})
      WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
    `);
    // Os privilégios padrão do banco dão CRUD ao role da aplicação: é preciso REVOGAR explicitamente.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM inventory_saas_app';
          EXECUTE 'GRANT SELECT, INSERT ON "audit_log" TO inventory_saas_app';
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE FUNCTION audit_insert(
        p_company uuid, p_entity_type text, p_entity_id uuid, p_entity_label text,
        p_action text, p_changes jsonb, p_summary jsonb
      ) RETURNS void AS $$
      DECLARE
        v_actor_id   uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
        v_actor_name text;
        v_actor_role text;
        v_previous   text := current_setting('app.current_company_id', true);
      BEGIN
        IF p_company IS NULL OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company) THEN
          RETURN;
        END IF;
        -- Ator lido ANTES de trocar de empresa: na sessão original ele é visível pela RLS de users
        -- (inclusive o master_admin, visível só em sessão sem tenant). Invisível/inexistente ⇒ NULL.
        IF v_actor_id IS NOT NULL THEN
          SELECT u.name, u.role::text INTO v_actor_name, v_actor_role FROM users u WHERE u.id = v_actor_id;
          IF NOT FOUND THEN
            v_actor_id := NULL;
          END IF;
        END IF;

        PERFORM set_config('app.current_company_id', p_company::text, true);
        INSERT INTO audit_log ("companyId", "actorUserId", "actorName", "actorRole", "entityType", "entityId",
                               "entityLabel", "action", "changes", "summary", "source", "reason", "requestId", "ip")
        VALUES (
          p_company, v_actor_id, v_actor_name, v_actor_role, p_entity_type, p_entity_id, left(p_entity_label, 200),
          p_action, COALESCE(p_changes, '[]'::jsonb), p_summary,
          COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'system'),
          NULLIF(current_setting('app.audit_reason', true), ''),
          NULLIF(current_setting('app.request_id', true), '')::uuid,
          NULLIF(current_setting('app.client_ip', true), '')::inet
        );
        PERFORM set_config('app.current_company_id', COALESCE(v_previous, ''), true);
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_insert(uuid, text, uuid, text, text, jsonb, jsonb)`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log"`);
  }
}

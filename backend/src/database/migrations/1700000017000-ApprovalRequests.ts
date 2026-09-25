import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE } from '../helpers/rls';

/**
 * SP2, etapa 2.2 — políticas de aprovação por empresa e fila de pedidos. `operation` e `entityLabel` não
 * estão na lista do spec (3.4): `operation` diz qual método reaplicar na aprovação (update/archive/delete) e
 * `entityLabel` guarda o nome legível do registro para a fila e a auditoria.
 */
export class ApprovalRequests1700000017000 implements MigrationInterface {
  name = 'ApprovalRequests1700000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" ADD COLUMN "approvalPolicies" jsonb NOT NULL DEFAULT '{}'::jsonb`);

    await queryRunner.query(`
      CREATE TABLE "change_requests" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId"         uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "policy"            varchar(30) NOT NULL
                            CHECK ("policy" IN ('price_change','retro_fix','loss_edit','archive_with_history')),
        "entityType"        varchar(40) NOT NULL,
        "entityId"          uuid NULL,
        "entityLabel"       varchar(200) NULL,
        "operation"         varchar(20) NOT NULL,
        "payload"           jsonb NOT NULL,
        "snapshot"          jsonb NOT NULL,
        "justification"     text NOT NULL,
        "status"            varchar(20) NOT NULL DEFAULT 'pending'
                            CHECK ("status" IN ('pending','approved','rejected','expired','cancelled')),
        "requestedByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "decidedByUserId"   uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "decidedAt"         timestamptz NULL,
        "decisionNote"      text NULL,
        "expiresAt"         timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
        "createdAt"         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_change_requests_company_status" ON "change_requests" ("companyId", "status", "createdAt" DESC)`,
    );
    // Um pendente por entidade + política (spec 3.4): pedir de novo cancela o anterior antes de inserir.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_change_requests_one_pending"
        ON "change_requests" ("companyId", "entityType", "entityId", "policy") WHERE "status" = 'pending'
    `);

    await queryRunner.query(`ALTER TABLE "change_requests" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "change_requests" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_change_requests" ON "change_requests"
      USING (${TENANT_COMPANY_ID_PREDICATE})
      WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
    `);
    // O app atualiza o status, mas nunca apaga um pedido (o histórico de decisões é parte da auditoria).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'REVOKE DELETE, TRUNCATE ON "change_requests" FROM inventory_saas_app';
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON "change_requests" TO inventory_saas_app';
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "change_requests"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "approvalPolicies"`);
  }
}

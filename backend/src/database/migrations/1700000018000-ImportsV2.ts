import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE } from '../helpers/rls';

const JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'uploaded',
  'simulating',
  'simulated',
  'pending_approval',
  'applying',
  'cancelled',
  'rolling_back',
  'rolled_back',
];

const PRICE_SOURCES_BEFORE = ['manual', 'import', 'bulk', 'retro_fix', 'erp', 'approval', 'backfill'];

const quoted = (values: string[]) => values.map((v) => `'${v}'`).join(',');

/**
 * SP3, etapa 3.1.1 — importação 2.0 (spec 1.1–1.4): `import_jobs.status` vira varchar com CHECK (os status novos
 * não entram num enum sem uma migration fora de transação), colunas do assistente em `import_jobs`, a tabela de
 * preparação `import_rows` (simulação + "antes" da gravação, base da reversão) e os mapeamentos salvos.
 */
export class ImportsV21700000018000 implements MigrationInterface {
  name = 'ImportsV21700000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "import_jobs" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "import_jobs" ALTER COLUMN "status" TYPE varchar(20) USING "status"::text`);
    await queryRunner.query(`ALTER TABLE "import_jobs" ALTER COLUMN "status" SET DEFAULT 'uploaded'`);
    await queryRunner.query(
      `ALTER TABLE "import_jobs" ADD CONSTRAINT "chk_import_jobs_status" CHECK ("status" IN (${quoted(JOB_STATUSES)}))`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "import_job_status_enum"`);

    await queryRunner.query(`
      ALTER TABLE "import_jobs"
        ADD COLUMN "resource"        varchar(40) NOT NULL DEFAULT 'products',
        ADD COLUMN "fileHash"        char(64) NULL,
        ADD COLUMN "format"          varchar(10) NULL,
        ADD COLUMN "encoding"        varchar(20) NULL,
        ADD COLUMN "delimiter"       varchar(4) NULL,
        ADD COLUMN "sheetName"       varchar(120) NULL,
        ADD COLUMN "headers"         jsonb NULL,
        ADD COLUMN "sheets"          jsonb NULL,
        ADD COLUMN "mapping"         jsonb NULL,
        ADD COLUMN "options"         jsonb NULL,
        ADD COLUMN "summary"         jsonb NULL,
        ADD COLUMN "errorReportKey"  varchar(500) NULL,
        ADD COLUMN "createdByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        ADD COLUMN "changeRequestId" uuid NULL,
        ADD COLUMN "simulatedAt"     timestamptz NULL,
        ADD COLUMN "appliedAt"       timestamptz NULL,
        ADD COLUMN "rolledBackAt"    timestamptz NULL,
        ADD COLUMN "lastError"       text NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_import_jobs_company_created" ON "import_jobs" ("companyId", "createdAt" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "import_rows" (
        "id"               bigserial PRIMARY KEY,
        "companyId"        uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "jobId"            uuid NOT NULL REFERENCES "import_jobs"("id") ON DELETE CASCADE,
        "rowNumber"        int NULL,
        "raw"              jsonb NULL,
        "normalized"       jsonb NULL,
        "key"              varchar(64) NULL,
        "action"           varchar(12) NOT NULL
                           CHECK ("action" IN ('create','update','reactivate','unchanged','error','duplicate','archive')),
        "diff"             jsonb NULL,
        "warnings"         text[] NOT NULL DEFAULT '{}',
        "errors"           text[] NOT NULL DEFAULT '{}',
        "productId"        uuid NULL,
        "before"           jsonb NULL,
        "appliedAction"    varchar(12) NULL,
        "appliedUpdatedAt" timestamptz NULL,
        "appliedAt"        timestamptz NULL,
        "rolledBackAt"     timestamptz NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_import_rows_job_action" ON "import_rows" ("jobId", "action", "rowNumber")`);
    await queryRunner.query(`CREATE INDEX "idx_import_rows_job_row" ON "import_rows" ("jobId", "rowNumber")`);
    await queryRunner.query(`CREATE INDEX "idx_import_rows_job_key" ON "import_rows" ("jobId", "key")`);

    await queryRunner.query(`
      CREATE TABLE "import_mappings" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId"         uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "resource"          varchar(40) NOT NULL,
        "name"              varchar(80) NOT NULL,
        "mapping"           jsonb NOT NULL,
        "headerFingerprint" char(64) NOT NULL,
        "createdByUserId"   uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "createdAt"         timestamptz NOT NULL DEFAULT now(),
        "lastUsedAt"        timestamptz NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_import_mappings_name" ON "import_mappings" ("companyId", "resource", "name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_import_mappings_fingerprint" ON "import_mappings" ("companyId", "resource", "headerFingerprint")`,
    );

    for (const table of ['import_rows', 'import_mappings']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING (${TENANT_COMPANY_ID_PREDICATE})
        WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
      `);
    }
    // A limpeza de 30 dias apaga linhas de preparação; mapeamentos salvos podem ser excluídos pelo gerente.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "import_rows" TO inventory_saas_app';
          EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE "import_rows_id_seq" TO inventory_saas_app';
          EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "import_mappings" TO inventory_saas_app';
        END IF;
      END
      $$
    `);

    await this.replacePriceSourceCheck(queryRunner, [...PRICE_SOURCES_BEFORE, 'import_rollback']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "product_price_history" SET "source" = 'import' WHERE "source" = 'import_rollback'`);
    await this.replacePriceSourceCheck(queryRunner, PRICE_SOURCES_BEFORE);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_mappings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_rows"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_import_jobs_company_created"`);
    await queryRunner.query(`
      ALTER TABLE "import_jobs"
        DROP COLUMN "resource", DROP COLUMN "fileHash", DROP COLUMN "format", DROP COLUMN "encoding",
        DROP COLUMN "delimiter", DROP COLUMN "sheetName", DROP COLUMN "headers", DROP COLUMN "sheets",
        DROP COLUMN "mapping", DROP COLUMN "options", DROP COLUMN "summary", DROP COLUMN "errorReportKey",
        DROP COLUMN "createdByUserId", DROP COLUMN "changeRequestId", DROP COLUMN "simulatedAt",
        DROP COLUMN "appliedAt", DROP COLUMN "rolledBackAt", DROP COLUMN "lastError"
    `);
    await queryRunner.query(`ALTER TABLE "import_jobs" DROP CONSTRAINT "chk_import_jobs_status"`);
    await queryRunner.query(
      `UPDATE "import_jobs" SET "status" = 'failed' WHERE "status" NOT IN ('pending','processing','completed','failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "import_job_status_enum" AS ENUM ('pending','processing','completed','failed')`,
    );
    await queryRunner.query(`ALTER TABLE "import_jobs" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "import_jobs" ALTER COLUMN "status" TYPE "import_job_status_enum" USING "status"::"import_job_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "import_jobs" ALTER COLUMN "status" SET DEFAULT 'pending'`);
  }

  /** O CHECK de source foi criado inline (nome gerado pelo Postgres): troca pelo nome encontrado no catálogo. */
  private async replacePriceSourceCheck(queryRunner: QueryRunner, sources: string[]): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE c text;
      BEGIN
        FOR c IN
          SELECT conname FROM pg_constraint
           WHERE conrelid = '"product_price_history"'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%source%'
        LOOP
          EXECUTE format('ALTER TABLE "product_price_history" DROP CONSTRAINT %I', c);
        END LOOP;
      END
      $$
    `);
    await queryRunner.query(
      `ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_source_check" CHECK ("source" IN (${quoted(sources)}))`,
    );
  }
}

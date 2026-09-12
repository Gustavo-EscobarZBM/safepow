import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImportJobs1700000001000 implements MigrationInterface {
  name = 'ImportJobs1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "import_job_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "import_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "status" import_job_status_enum NOT NULL DEFAULT 'pending',
        "fileName" varchar(255) NOT NULL,
        "storageKey" varchar(500) NOT NULL,
        "totalRows" int,
        "successCount" int NOT NULL DEFAULT 0,
        "errorCount" int NOT NULL DEFAULT 0,
        "errorReport" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "completedAt" timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_import_jobs_company" ON "import_jobs" ("companyId")`);

    await queryRunner.query(`ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_import_jobs" ON "import_jobs"
      USING ("companyId" = current_setting('app.current_company_id', true)::uuid)
      WITH CHECK ("companyId" = current_setting('app.current_company_id', true)::uuid)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON "import_jobs" TO inventory_saas_app';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_import_jobs" ON "import_jobs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_jobs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "import_job_status_enum"`);
  }
}

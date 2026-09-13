import { MigrationInterface, QueryRunner } from 'typeorm';

// Faturamento mensal informado manualmente pelo gerente — usado para calcular
// a taxa de perda sobre faturamento (shrinkage rate) no dashboard. Um valor
// por empresa/ano/mês; sem valor cadastrado, a taxa simplesmente não aparece
// (não tem como inferir faturamento).
export class CompanyMonthlyRevenue1700000008000 implements MigrationInterface {
  name = 'CompanyMonthlyRevenue1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "company_monthly_revenue" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "year" integer NOT NULL,
        "month" integer NOT NULL,
        "revenueAmount" numeric(12,2) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_company_monthly_revenue_company_year_month" ON "company_monthly_revenue" ("companyId", "year", "month")`,
    );
    await queryRunner.query(`ALTER TABLE "company_monthly_revenue" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "company_monthly_revenue" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_company_monthly_revenue" ON "company_monthly_revenue"
      USING ("companyId" = current_setting('app.current_company_id', true)::uuid)
      WITH CHECK ("companyId" = current_setting('app.current_company_id', true)::uuid)
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "company_monthly_revenue" TO inventory_saas_app';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_company_monthly_revenue" ON "company_monthly_revenue"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "company_monthly_revenue"`);
  }
}

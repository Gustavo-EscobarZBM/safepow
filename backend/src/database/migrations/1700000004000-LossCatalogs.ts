import { MigrationInterface, QueryRunner } from 'typeorm';

// Motivo/Local da perda deixam de ser enums fixos no código e viram catálogos
// por empresa (Painel > Cadastros), com o Gerente podendo cadastrar/excluir
// suas próprias opções. A tabela "losses" já tem dados reais (perdas
// registradas nos testes desta sessão), então esta migration preserva os
// registros existentes: semeia, para cada empresa já cadastrada, as mesmas
// opções que hoje são os labels fixos, e faz o backfill de losses.reason/
// location (enum) para reasonId/locationId (uuid) casando pelo nome antes de
// finalmente remover as colunas antigas.
export class LossCatalogs1700000004000 implements MigrationInterface {
  name = 'LossCatalogs1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['loss_reasons', 'loss_locations']) {
      await queryRunner.query(`
        CREATE TABLE "${table}" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
          "name" varchar(120) NOT NULL,
          "createdAt" timestamptz NOT NULL DEFAULT now()
        )
      `);
      await queryRunner.query(`CREATE UNIQUE INDEX "uq_${table}_company_name" ON "${table}" ("companyId", "name")`);
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING ("companyId" = current_setting('app.current_company_id', true)::uuid)
        WITH CHECK ("companyId" = current_setting('app.current_company_id', true)::uuid)
      `);
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
            EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO inventory_saas_app';
          END IF;
        END
        $$;
      `);
    }

    // Semeia cada empresa já existente com as mesmas opções que hoje são os
    // labels fixos — ninguém perde o que já usava, só ganha a edição da lista.
    await queryRunner.query(`
      INSERT INTO "loss_reasons" ("companyId", "name")
      SELECT c.id, seed.label
      FROM "companies" c
      CROSS JOIN (VALUES
        ('Vencimento/Validade'),
        ('Quebra/Avaria'),
        ('Furto'),
        ('Erro operacional'),
        ('Outro')
      ) AS seed(label)
    `);
    await queryRunner.query(`
      INSERT INTO "loss_locations" ("companyId", "name")
      SELECT c.id, seed.label
      FROM "companies" c
      CROSS JOIN (VALUES
        ('Loja/Gôndola'),
        ('Câmara fria'),
        ('Depósito/Estoque'),
        ('Recebimento de mercadoria'),
        ('Caixa/Frente de loja'),
        ('Outro')
      ) AS seed(label)
    `);

    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "reasonId" uuid`);
    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "locationId" uuid`);

    await queryRunner.query(`
      UPDATE "losses" l
      SET "reasonId" = lr.id
      FROM "loss_reasons" lr
      WHERE lr."companyId" = l."companyId"
        AND lr."name" = CASE l."reason"::text
          WHEN 'vencimento' THEN 'Vencimento/Validade'
          WHEN 'quebra_avaria' THEN 'Quebra/Avaria'
          WHEN 'furto' THEN 'Furto'
          WHEN 'erro_operacional' THEN 'Erro operacional'
          WHEN 'outro' THEN 'Outro'
        END
    `);
    await queryRunner.query(`
      UPDATE "losses" l
      SET "locationId" = ll.id
      FROM "loss_locations" ll
      WHERE ll."companyId" = l."companyId"
        AND ll."name" = CASE l."location"::text
          WHEN 'loja' THEN 'Loja/Gôndola'
          WHEN 'camara_fria' THEN 'Câmara fria'
          WHEN 'deposito' THEN 'Depósito/Estoque'
          WHEN 'recebimento' THEN 'Recebimento de mercadoria'
          WHEN 'caixa' THEN 'Caixa/Frente de loja'
          WHEN 'outro' THEN 'Outro'
        END
    `);

    await queryRunner.query(`ALTER TABLE "losses" ALTER COLUMN "reasonId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "losses" ALTER COLUMN "locationId" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "losses" ADD CONSTRAINT "fk_losses_reason" FOREIGN KEY ("reasonId") REFERENCES "loss_reasons"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "losses" ADD CONSTRAINT "fk_losses_location" FOREIGN KEY ("locationId") REFERENCES "loss_locations"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "reason"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "location"`);
    await queryRunner.query(`DROP TYPE "loss_reason_enum"`);
    await queryRunner.query(`DROP TYPE "loss_location_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Melhor esforço: como o Gerente pode ter cadastrado motivos/locais livres
    // (fora do enum original), o rollback não tenta remapear valores custom —
    // apenas restaura a coluna enum com um default seguro, mesmo padrão de
    // simplificação já usado no down() da migration LossReasonAndLocation.
    await queryRunner.query(`
      CREATE TYPE "loss_reason_enum" AS ENUM ('vencimento', 'quebra_avaria', 'furto', 'erro_operacional', 'outro')
    `);
    await queryRunner.query(`
      CREATE TYPE "loss_location_enum" AS ENUM ('loja', 'camara_fria', 'deposito', 'recebimento', 'caixa', 'outro')
    `);
    await queryRunner.query(`ALTER TABLE "losses" DROP CONSTRAINT "fk_losses_reason"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP CONSTRAINT "fk_losses_location"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "reasonId"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "locationId"`);
    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "reason" "loss_reason_enum" NOT NULL DEFAULT 'outro'`);
    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "location" "loss_location_enum" NOT NULL DEFAULT 'outro'`);

    for (const table of ['loss_reasons', 'loss_locations']) {
      await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}

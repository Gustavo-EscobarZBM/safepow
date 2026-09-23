import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE, withoutForcedRls } from '../helpers/rls';

/**
 * Histórico de preço/custo do produto (sub-etapa 1.2.2 — spec do SP1, seção 4.1). Append-only,
 * alimentado por um trigger em products — funciona para TODO escritor (painel, importação atual,
 * edição em massa futura, ERP), sem precisar chamar nenhum serviço.
 */
export class ProductPriceHistory1700000011000 implements MigrationInterface {
  name = 'ProductPriceHistory1700000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_price_history" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "seq"             bigint GENERATED ALWAYS AS IDENTITY,
        "companyId"       uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "productId"       uuid NOT NULL REFERENCES "products"("id")  ON DELETE CASCADE,
        "unitPrice"       numeric(12,2) NOT NULL,
        "costPrice"       numeric(12,2) NOT NULL,
        "validFrom"       timestamptz   NOT NULL,
        "changedByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "source"          varchar(20) NOT NULL DEFAULT 'manual'
                          CHECK ("source" IN ('manual','import','bulk','retro_fix','erp','approval','backfill')),
        "createdAt"       timestamptz   NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_price_history_product_valid"
        ON "product_price_history" ("productId", "validFrom" DESC, "seq" DESC)
    `);

    await queryRunner.query(`ALTER TABLE "product_price_history" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "product_price_history" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_product_price_history" ON "product_price_history"
      USING (${TENANT_COMPANY_ID_PREDICATE})
      WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'GRANT SELECT, INSERT ON "product_price_history" TO inventory_saas_app';
        END IF;
      END
      $$
    `);

    // Dispara em toda mudança de preço/custo — inclusive a gravada pelo próprio backfill abaixo? NÃO:
    // o trigger é AFTER INSERT/UPDATE em "products", e o backfill só faz INSERT em
    // product_price_history diretamente, sem tocar "products" — então não há dupla contagem.
    await queryRunner.query(`
      CREATE FUNCTION record_product_price_history() RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT'
          OR NEW."unitPrice" IS DISTINCT FROM OLD."unitPrice"
          OR NEW."costPrice" IS DISTINCT FROM OLD."costPrice"
        THEN
          INSERT INTO product_price_history
            ("companyId", "productId", "unitPrice", "costPrice", "validFrom", "changedByUserId", "source")
          VALUES (
            NEW."companyId",
            NEW.id,
            NEW."unitPrice",
            NEW."costPrice",
            clock_timestamp(),
            NULLIF(current_setting('app.current_user_id', true), '')::uuid,
            COALESCE(NULLIF(current_setting('app.change_source', true), ''), 'manual')
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_record_product_price_history
        AFTER INSERT OR UPDATE OF "unitPrice", "costPrice" ON "products"
        FOR EACH ROW EXECUTE FUNCTION record_product_price_history()
    `);

    // Backfill: uma linha por produto já existente, com o preço/custo ATUAL (o valor real do passado
    // é irrecuperável) e validFrom = a criação do produto. Sem withoutForcedRls, o SELECT em "products"
    // não enxergaria nenhuma linha (nenhuma empresa "atual" durante uma migration) e o INSERT em
    // product_price_history falharia na WITH CHECK pelo mesmo motivo — ver RK1 no desenho mestre.
    await withoutForcedRls(queryRunner, ['products', 'product_price_history'], async () => {
      await queryRunner.query(`
        INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", "source")
        SELECT "companyId", "id", "unitPrice", "costPrice", "createdAt", 'backfill'
        FROM products
      `);
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_record_product_price_history ON "products"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS record_product_price_history()`);
    await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_product_price_history" ON "product_price_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_price_history"`);
  }
}

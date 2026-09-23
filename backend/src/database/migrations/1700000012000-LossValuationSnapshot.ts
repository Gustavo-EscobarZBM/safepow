import { MigrationInterface, QueryRunner } from 'typeorm';
import { withoutForcedRls } from '../helpers/rls';

/**
 * Valor congelado da perda (sub-etapa 1.2.2 — spec do SP1, seção 4.1). A partir da sub-etapa 1.2.3 a
 * aplicação passa a gravar unitPriceAtLoss/unitCostAtLoss/valuationSource explicitamente (preço
 * vigente em occurredAt, via histórico de product_price_history); até lá — e como rede de segurança
 * depois — o trigger BEFORE INSERT preenche com o preço ATUAL do produto se a aplicação não informar.
 */
export class LossValuationSnapshot1700000012000 implements MigrationInterface {
  name = 'LossValuationSnapshot1700000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "losses"
        ADD COLUMN "unitPriceAtLoss" numeric(12,2),
        ADD COLUMN "unitCostAtLoss"  numeric(12,2),
        ADD COLUMN "valuationSource" varchar(20)
    `);

    // Backfill: preenche as perdas já existentes com o preço ATUAL do produto (o valor real da época
    // é irrecuperável) — sem withoutForcedRls, este UPDATE não enxergaria nenhuma linha de "losses"
    // nem de "products" (nenhuma empresa "atual" durante uma migration) e não faria nada, silenciosamente.
    await withoutForcedRls(queryRunner, ['losses', 'products'], async () => {
      await queryRunner.query(`
        UPDATE "losses" l
        SET "unitPriceAtLoss" = p."unitPrice",
            "unitCostAtLoss"  = p."costPrice",
            "valuationSource" = 'backfill_current'
        FROM "products" p
        WHERE p.id = l."productId"
      `);
    });

    await queryRunner.query(`
      ALTER TABLE "losses"
        ALTER COLUMN "unitPriceAtLoss" SET NOT NULL,
        ALTER COLUMN "unitCostAtLoss"  SET NOT NULL,
        ALTER COLUMN "valuationSource" SET NOT NULL,
        ALTER COLUMN "valuationSource" SET DEFAULT 'snapshot',
        ADD CONSTRAINT "chk_losses_valuation_source" CHECK ("valuationSource" IN
          ('snapshot','backfill_current','fallback_current','recalculated','pending_product'))
    `);

    // Rede de segurança: só age se a aplicação não informar o valor. O SELECT em "products" é
    // filtrado por RLS igual a qualquer outra consulta — fora de contexto de tenant, ou quando
    // productId aponta para produto de OUTRA empresa (bug/dado inconsistente), o SELECT não vê nada,
    // as colunas ficam NULL e a restrição NOT NULL acima barra o INSERT — falha alto de propósito.
    await queryRunner.query(`
      CREATE FUNCTION losses_valuation_fallback() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."unitPriceAtLoss" IS NULL OR NEW."unitCostAtLoss" IS NULL THEN
          SELECT "unitPrice", "costPrice" INTO NEW."unitPriceAtLoss", NEW."unitCostAtLoss"
          FROM products WHERE id = NEW."productId";
          NEW."valuationSource" := 'fallback_current';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_losses_valuation_fallback
        BEFORE INSERT ON "losses"
        FOR EACH ROW EXECUTE FUNCTION losses_valuation_fallback()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_losses_valuation_fallback ON "losses"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS losses_valuation_fallback()`);
    await queryRunner.query(`ALTER TABLE "losses" DROP CONSTRAINT IF EXISTS "chk_losses_valuation_source"`);
    await queryRunner.query(`
      ALTER TABLE "losses"
        DROP COLUMN "unitPriceAtLoss",
        DROP COLUMN "unitCostAtLoss",
        DROP COLUMN "valuationSource"
    `);
  }
}

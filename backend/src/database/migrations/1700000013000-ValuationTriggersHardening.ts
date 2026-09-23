import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Endurece os dois triggers de valor da sub-etapa 1.2.2 (achados da revisão final dela):
 * - record_product_price_history: changedByUserId passa a ser procurado em "users" — um id que não
 *   existe (token de usuário já excluído) ou que a RLS esconde vira NULL, em vez de violar a FK e
 *   derrubar a edição de preço com 500.
 * - losses_valuation_fallback: completa só a coluna que veio NULL (COALESCE por coluna) — antes, um
 *   preço explícito com custo ausente perdia o preço explícito.
 * - Ambas com search_path fixo: nomes não qualificados não dependem do search_path de quem chama.
 * SECURITY INVOKER (padrão) de propósito: a RLS continua valendo dentro dos triggers.
 */
export class ValuationTriggersHardening1700000013000 implements MigrationInterface {
  name = 'ValuationTriggersHardening1700000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_product_price_history() RETURNS TRIGGER AS $$
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
            (SELECT u.id FROM users u
              WHERE u.id = NULLIF(current_setting('app.current_user_id', true), '')::uuid),
            COALESCE(NULLIF(current_setting('app.change_source', true), ''), 'manual')
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION losses_valuation_fallback() RETURNS TRIGGER AS $$
      DECLARE
        current_price numeric(12,2);
        current_cost  numeric(12,2);
      BEGIN
        IF NEW."unitPriceAtLoss" IS NULL OR NEW."unitCostAtLoss" IS NULL THEN
          SELECT "unitPrice", "costPrice" INTO current_price, current_cost
          FROM products WHERE id = NEW."productId";
          NEW."unitPriceAtLoss" := COALESCE(NEW."unitPriceAtLoss", current_price);
          NEW."unitCostAtLoss"  := COALESCE(NEW."unitCostAtLoss", current_cost);
          NEW."valuationSource" := 'fallback_current';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);
  }

  /** Restaura exatamente as versões das migrations 11000 e 12000. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_product_price_history() RETURNS TRIGGER AS $$
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
    await queryRunner.query(`ALTER FUNCTION record_product_price_history() RESET search_path`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION losses_valuation_fallback() RETURNS TRIGGER AS $$
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
    await queryRunner.query(`ALTER FUNCTION losses_valuation_fallback() RESET search_path`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
import { TENANT_COMPANY_ID_PREDICATE } from '../helpers/rls';

const NIL_UUID = `'00000000-0000-0000-0000-000000000000'::uuid`;
const TAXONOMY_TABLES: Record<string, string> = { categories: 'category', brands: 'brand', suppliers: 'supplier' };

/**
 * SP4, etapa 4.1 (spec 3.1) — categorias (até 3 níveis), marcas e fornecedores por empresa, e os campos novos do
 * produto. Cadastros são arquivados (isActive), nunca apagados pela aplicação: o role do app não recebe DELETE e as
 * FKs de products usam RESTRICT. O custo passa a 4 casas (item fracionado) no produto, no histórico de preço e na
 * cópia congelada da perda.
 */
export class ProductCatalogData1700000020000 implements MigrationInterface {
  name = 'ProductCatalogData1700000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name"      varchar(80) NOT NULL CHECK (btrim("name") <> ''),
        "parentId"  uuid NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
        "isActive"  boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // NULL não conflita em UNIQUE comum: as raízes precisam de um "pai" fixo para ficarem num grupo só.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_categories_company_parent_name"
        ON "categories" ("companyId", COALESCE("parentId", ${NIL_UUID}), lower("name"))
    `);
    await queryRunner.query(`CREATE INDEX "idx_categories_parent" ON "categories" ("parentId")`);

    await queryRunner.query(`
      CREATE TABLE "brands" (
        "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name"      varchar(80) NOT NULL CHECK (btrim("name") <> ''),
        "isActive"  boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_brands_company_name" ON "brands" ("companyId", lower("name"))`);

    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId"   uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name"        varchar(120) NOT NULL CHECK (btrim("name") <> ''),
        "taxId"       varchar(18) NULL,
        "contactName" varchar(120) NULL,
        "phone"       varchar(30) NULL,
        "email"       varchar(160) NULL,
        "notes"       text NULL,
        "isActive"    boolean NOT NULL DEFAULT true,
        "createdAt"   timestamptz NOT NULL DEFAULT now(),
        "updatedAt"   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_suppliers_company_name" ON "suppliers" ("companyId", lower("name"))`);

    // Árvore de categorias: mesmo tenant, sem ciclo, no máximo 3 níveis contando as descendentes de quem é movido.
    await queryRunner.query(`
      CREATE FUNCTION categories_check_tree() RETURNS trigger AS $$
      DECLARE
        v_parent_company uuid;
        v_ancestors int;
        v_cycle boolean;
        v_below int;
      BEGIN
        IF NEW."parentId" IS NULL THEN
          v_ancestors := 0;
        ELSE
          IF NEW."parentId" = NEW."id" THEN
            RAISE EXCEPTION 'categoria: uma categoria não pode ser pai dela mesma.' USING ERRCODE = 'check_violation';
          END IF;
          SELECT "companyId" INTO v_parent_company FROM categories WHERE id = NEW."parentId";
          IF v_parent_company IS NULL OR v_parent_company <> NEW."companyId" THEN
            RAISE EXCEPTION 'categoria: categoria pai não encontrada.' USING ERRCODE = 'check_violation';
          END IF;
          WITH RECURSIVE up(id, "parentId", depth) AS (
            SELECT c.id, c."parentId", 1 FROM categories c WHERE c.id = NEW."parentId"
            UNION ALL
            SELECT c.id, c."parentId", up.depth + 1 FROM categories c JOIN up ON c.id = up."parentId" WHERE up.depth < 10
          )
          SELECT max(depth), bool_or(id = NEW."id") INTO v_ancestors, v_cycle FROM up;
          IF v_cycle THEN
            RAISE EXCEPTION 'categoria: não é possível mover uma categoria para dentro de uma subcategoria dela.'
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;

        v_below := 0;
        IF TG_OP = 'UPDATE' THEN
          WITH RECURSIVE down(id, depth) AS (
            SELECT c.id, 1 FROM categories c WHERE c."parentId" = NEW."id"
            UNION ALL
            SELECT c.id, down.depth + 1 FROM categories c JOIN down ON c."parentId" = down.id WHERE down.depth < 10
          )
          SELECT COALESCE(max(depth), 0) INTO v_below FROM down;
        END IF;

        IF v_ancestors + 1 + v_below > 3 THEN
          RAISE EXCEPTION 'categoria: o limite é de 3 níveis (ex.: Mercearia > Bebidas > Refrigerantes).'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_categories_check_tree"
        BEFORE INSERT OR UPDATE OF "parentId", "companyId" ON "categories"
        FOR EACH ROW EXECUTE FUNCTION categories_check_tree()
    `);

    for (const [table, entityType] of Object.entries(TAXONOMY_TABLES)) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING (${TENANT_COMPANY_ID_PREDICATE})
        WITH CHECK (${TENANT_COMPANY_ID_PREDICATE})
      `);
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
            EXECUTE 'GRANT SELECT, INSERT, UPDATE ON "${table}" TO inventory_saas_app';
          END IF;
        END
        $$
      `);
      await queryRunner.query(`
        CREATE TRIGGER "trg_audit_${table}"
          AFTER INSERT OR UPDATE OR DELETE ON "${table}"
          FOR EACH ROW EXECUTE FUNCTION audit_row_change('${entityType}', '')
      `);
    }

    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN "categoryId"    uuid NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
        ADD COLUMN "brandId"       uuid NULL REFERENCES "brands"("id") ON DELETE RESTRICT,
        ADD COLUMN "supplierId"    uuid NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        ADD COLUMN "unit"          varchar(4) NOT NULL DEFAULT 'UN'
                                   CHECK ("unit" IN ('UN','KG','G','L','ML','CX','PCT','DZ','M')),
        ADD COLUMN "isPerishable"  boolean NOT NULL DEFAULT false,
        ADD COLUMN "shelfLifeDays" int NULL CHECK ("shelfLifeDays" > 0),
        ADD COLUMN "imageUrl"      varchar(500) NULL,
        ADD COLUMN "notes"         text NULL,
        ADD COLUMN "reviewStatus"  varchar(10) NOT NULL DEFAULT 'approved'
                                   CHECK ("reviewStatus" IN ('approved','pending'))
    `);
    await queryRunner.query(`CREATE INDEX "idx_products_category" ON "products" ("categoryId")`);
    await queryRunner.query(`CREATE INDEX "idx_products_brand" ON "products" ("brandId")`);
    await queryRunner.query(`CREATE INDEX "idx_products_supplier" ON "products" ("supplierId")`);

    await this.setCostScale(queryRunner, 4);
  }

  /**
   * O Postgres não muda o tipo de uma coluna citada num trigger "UPDATE OF": o do histórico de preço (11000) sai e
   * volta idêntico em volta do ALTER (tudo na transação da migration). Aumentar a escala não perde dado.
   */
  private async setCostScale(queryRunner: QueryRunner, scale: 2 | 4): Promise<void> {
    await queryRunner.query(`DROP TRIGGER trg_record_product_price_history ON "products"`);
    await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "costPrice" TYPE numeric(12,${scale})`);
    await queryRunner.query(`ALTER TABLE "product_price_history" ALTER COLUMN "costPrice" TYPE numeric(12,${scale})`);
    await queryRunner.query(`ALTER TABLE "losses" ALTER COLUMN "unitCostAtLoss" TYPE numeric(12,${scale})`);
    await queryRunner.query(`
      CREATE TRIGGER trg_record_product_price_history
        AFTER INSERT OR UPDATE OF "unitPrice", "costPrice" ON "products"
        FOR EACH ROW EXECUTE FUNCTION record_product_price_history()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.setCostScale(queryRunner, 2);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "categoryId", DROP COLUMN IF EXISTS "brandId", DROP COLUMN IF EXISTS "supplierId",
        DROP COLUMN IF EXISTS "unit", DROP COLUMN IF EXISTS "isPerishable", DROP COLUMN IF EXISTS "shelfLifeDays",
        DROP COLUMN IF EXISTS "imageUrl", DROP COLUMN IF EXISTS "notes", DROP COLUMN IF EXISTS "reviewStatus"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "suppliers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "brands"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "categories"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS categories_check_tree()`);
  }
}

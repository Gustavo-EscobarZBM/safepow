import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice do sync de produtos (SP1, 6.1): o GET /products paginado filtra por empresa (RLS) e ordena por
 * (updatedAt, id) com continuação por tupla — este índice atende as duas coisas. O spec citava o número
 * 1700000012000, escrito antes de as sub-etapas 1.2.x ocuparem 11000–13000.
 */
export class ProductsSyncIndex1700000014000 implements MigrationInterface {
  name = 'ProductsSyncIndex1700000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_products_company_updated_id" ON "products" ("companyId", "updatedAt", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_company_updated_id"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

// Preço de custo do produto (o que a empresa pagou) — usado para calcular o
// "prejuízo de custo" nos relatórios, separado da "receita perdida" (que já
// usa unitPrice). Produtos existentes ficam com costPrice = 0 até o gerente
// preencher (não há como inferir o custo retroativamente).
export class ProductCostPrice1700000007000 implements MigrationInterface {
  name = 'ProductCostPrice1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN "costPrice" numeric(12,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "costPrice"`);
  }
}

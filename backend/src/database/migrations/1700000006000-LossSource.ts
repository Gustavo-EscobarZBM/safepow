import { MigrationInterface, QueryRunner } from 'typeorm';

// Rastreia se a perda foi registrada pelo app mobile (funcionário) ou pelo
// formulário do painel web — alimenta a coluna "Origem" na tela de perdas do
// gerente. Registros anteriores a esta migration ficam com source = NULL, já
// que não há como inferir a origem retroativamente.
export class LossSource1700000006000 implements MigrationInterface {
  name = 'LossSource1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "loss_source_enum" AS ENUM ('mobile', 'web')`);
    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "source" "loss_source_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TYPE "loss_source_enum"`);
  }
}

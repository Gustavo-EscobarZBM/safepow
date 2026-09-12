import { MigrationInterface, QueryRunner } from 'typeorm';

// A descrição da perda deixou de ser obrigatória no app mobile — o
// funcionário pode registrar a perda sem escrever o que aconteceu.
export class LossDescriptionOptional1700000005000 implements MigrationInterface {
  name = 'LossDescriptionOptional1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "losses" ALTER COLUMN "description" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "losses" SET "description" = '' WHERE "description" IS NULL`);
    await queryRunner.query(`ALTER TABLE "losses" ALTER COLUMN "description" SET NOT NULL`);
  }
}

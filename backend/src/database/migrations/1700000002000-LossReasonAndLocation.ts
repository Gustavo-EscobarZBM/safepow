import { MigrationInterface, QueryRunner } from 'typeorm';

// Introduz "motivo" e transforma "local" de texto livre em seleção fixa
// (Seção 2 do documento — os dois passam a ser campos obrigatórios de
// seleção no registro de uma perda, usados como dimensões de análise no
// dashboard gerencial). A tabela "losses" está vazia neste ponto do projeto
// (app mobile ainda não existe), então não há necessidade de backfill.
export class LossReasonAndLocation1700000002000 implements MigrationInterface {
  name = 'LossReasonAndLocation1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "loss_reason_enum" AS ENUM ('vencimento', 'quebra_avaria', 'furto', 'erro_operacional', 'outro')
    `);
    await queryRunner.query(`
      CREATE TYPE "loss_location_enum" AS ENUM ('loja', 'camara_fria', 'deposito', 'recebimento', 'caixa', 'outro')
    `);

    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "location"`);
    await queryRunner.query(`
      ALTER TABLE "losses" ADD COLUMN "location" "loss_location_enum" NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "losses" ADD COLUMN "reason" "loss_reason_enum" NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "reason"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "location"`);
    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "location" varchar(150) NOT NULL DEFAULT ''`);
    await queryRunner.query(`DROP TYPE "loss_reason_enum"`);
    await queryRunner.query(`DROP TYPE "loss_location_enum"`);
  }
}

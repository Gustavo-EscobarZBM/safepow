import { MigrationInterface, QueryRunner } from 'typeorm';

// Conferência de descarte (spec seção 5): etapa opcional de segunda validação
// sobre o que foi descartado. ON DELETE SET NULL nas duas FKs novas pra users
// — remover o usuário que era conferente não pode travar a exclusão dele nem
// apagar o histórico de quem já confirmou perdas antigas.
export class LossVerification1700000009000 implements MigrationInterface {
  name = 'LossVerification1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN "lossVerificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN "lossVerifierId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "losses" ADD COLUMN "requiresVerification" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "verifiedAt" timestamptz NULL`);
    await queryRunner.query(
      `ALTER TABLE "losses" ADD COLUMN "verifiedByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "verifiedByUserId"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "verifiedAt"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "requiresVerification"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "lossVerifierId"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "lossVerificationEnabled"`);
  }
}

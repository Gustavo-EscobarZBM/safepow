import { MigrationInterface, QueryRunner } from 'typeorm';

// Suporte à ação "Desbloquear" do Painel Master: reativa o acesso sem gerar
// um novo ciclo de cobrança. Guardamos quando isso aconteceu para que o
// cálculo automático de status (baseado no vencimento) não bloqueie de novo
// a empresa pelo mesmo ciclo já perdoado — ver company-status.util.ts.
export class CompanyManualUnlock1700000003000 implements MigrationInterface {
  name = 'CompanyManualUnlock1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" ADD COLUMN "lastManualUnlockAt" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "lastManualUnlockAt"`);
  }
}

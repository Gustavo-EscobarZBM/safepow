import { MigrationInterface, QueryRunner } from 'typeorm';

const AUDIT_ACTIONS_BEFORE = [
  'create', 'update', 'archive', 'restore', 'delete', 'import', 'login', 'login_failed',
  'approve', 'reject', 'retro_fix', 'request', 'justify',
];

const quoted = (values: string[]) => values.map((v) => `'${v}'`).join(',');

/**
 * SP3, etapa 3.4 — reversão de importação (spec 2.6): cada linha revertida guarda o resultado (`restored` ou
 * `conflict` — produto mudado depois da importação, que fica como está), o que torna a reversão retomável e a lista de
 * conflitos consultável depois. A auditoria ganha a ação `rollback`.
 */
export class ImportRollback1700000019000 implements MigrationInterface {
  name = 'ImportRollback1700000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "import_rows"
        ADD COLUMN "rollbackResult" varchar(12) NULL CHECK ("rollbackResult" IN ('restored','conflict'))
    `);
    await this.replaceAuditActionCheck(queryRunner, [...AUDIT_ACTIONS_BEFORE, 'rollback']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "audit_log" WHERE "action" = 'rollback'`);
    await this.replaceAuditActionCheck(queryRunner, AUDIT_ACTIONS_BEFORE);
    await queryRunner.query(`ALTER TABLE "import_rows" DROP COLUMN "rollbackResult"`);
  }

  /** O CHECK de action foi criado inline (nome gerado pelo Postgres): troca pelo nome encontrado no catálogo. */
  private async replaceAuditActionCheck(queryRunner: QueryRunner, actions: string[]): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE c text;
      BEGIN
        FOR c IN
          SELECT conname FROM pg_constraint
           WHERE conrelid = '"audit_log"'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%(action)%'
        LOOP
          EXECUTE format('ALTER TABLE "audit_log" DROP CONSTRAINT %I', c);
        END LOOP;
      END
      $$
    `);
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK ("action" IN (${quoted(actions)}))`,
    );
  }
}

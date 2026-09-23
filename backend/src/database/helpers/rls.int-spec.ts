import { DataSource, QueryRunner } from 'typeorm';
import { testDbConfig } from '../../test-utils/test-db';
import { withoutForcedRls } from './rls';

/** Conexão como DONO das tabelas (sem superusuário) — é assim que as migrations rodam. */
let ownerDataSource: DataSource;

async function isForced(queryRunner: QueryRunner, table: string): Promise<boolean> {
  const rows = await queryRunner.query(`SELECT relforcerowsecurity FROM pg_class WHERE relname = $1`, [table]);
  return rows[0].relforcerowsecurity;
}

describe('withoutForcedRls — dentro da transação da migration', () => {
  beforeAll(async () => {
    const cfg = testDbConfig();
    ownerDataSource = new DataSource({
      type: 'postgres',
      host: cfg.host,
      port: cfg.port,
      username: cfg.ownerUser,
      password: cfg.ownerPassword,
      database: cfg.database,
    });
    await ownerDataSource.initialize();
  });
  afterAll(() => ownerDataSource.destroy());

  it('religa FORCE ao final quando fn termina bem', async () => {
    const queryRunner = ownerDataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      let forcedDuring: boolean | undefined;
      await withoutForcedRls(queryRunner, ['products'], async () => {
        forcedDuring = await isForced(queryRunner, 'products');
      });
      expect(forcedDuring).toBe(false);
      expect(await isForced(queryRunner, 'products')).toBe(true);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  it('o erro original de fn chega intacto (não é trocado por "current transaction is aborted")', async () => {
    const queryRunner = ownerDataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      await expect(
        withoutForcedRls(queryRunner, ['products'], async () => {
          await queryRunner.query('SELECT 1 / 0');
        }),
      ).rejects.toThrow(/division by zero/);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});

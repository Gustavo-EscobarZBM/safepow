import { getTestDbConfig, TestDbConfig } from './test-db-config';
import { queryAsAdmin, queryAsOwner, queryWith } from './test-db-lifecycle';

// Porta 1: nada escuta nela. Se a trava um dia regredir, o teste falha em vez de
// chegar a conectar em algum Postgres real (o banco de desenvolvimento, por exemplo).
const ENV = {
  DB_HOST: 'localhost',
  DB_PORT: '1',
  DB_ADMIN_USER: 'postgres',
  DB_ADMIN_PASSWORD: 'admin-pw',
  DB_APP_USER: 'inventory_saas_app',
  DB_APP_PASSWORD: 'app-pw',
} as NodeJS.ProcessEnv;

// TestDbConfig é um objeto comum: nada impede montar um que aponte para o banco de desenvolvimento.
const devDbConfig: TestDbConfig = { ...getTestDbConfig(undefined, ENV), database: 'inventory_saas' };

describe('trava de banco de teste nas consultas do harness', () => {
  it('queryAsAdmin recusa uma config que aponta para um banco que não é de teste', async () => {
    await expect(queryAsAdmin(devDbConfig, 'SELECT 1')).rejects.toThrow(/_test/);
  });

  it('queryAsOwner recusa uma config que aponta para um banco que não é de teste', async () => {
    await expect(queryAsOwner(devDbConfig, 'SELECT 1')).rejects.toThrow(/_test/);
  });

  it('queryWith recusa quando credentials.database diverge de cfg.database (mesmo com cfg.database válido)', async () => {
    const cfg = getTestDbConfig(undefined, ENV); // cfg.database = 'inventory_saas_test', válido
    await expect(
      queryWith(cfg, { user: cfg.adminUser, password: cfg.adminPassword, database: 'inventory_saas' }, 'SELECT 1', []),
    ).rejects.toThrow(/_test/);
  });
});

import { assertTestDatabaseName, DEFAULT_TEST_DB_NAME, getTestDbConfig } from './test-db-config';

const ENV = {
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_ADMIN_USER: 'postgres',
  DB_ADMIN_PASSWORD: 'admin-pw',
  DB_APP_USER: 'inventory_saas_app',
  DB_APP_PASSWORD: 'app-pw',
  DB_NAME: 'inventory_saas',
} as NodeJS.ProcessEnv;

describe('trava de segurança do banco de testes', () => {
  it('recusa o banco de desenvolvimento e qualquer nome sem o sufixo _test', () => {
    expect(() => assertTestDatabaseName('inventory_saas')).toThrow(/_test/);
    expect(() => assertTestDatabaseName('postgres')).toThrow(/_test/);
  });

  it('aceita nomes de banco de teste válidos', () => {
    expect(() => assertTestDatabaseName('inventory_saas_test')).not.toThrow();
    expect(() => assertTestDatabaseName('inventory_saas_harness_test')).not.toThrow();
  });

  it('recusa nomes com caracteres que permitiriam injeção em SQL', () => {
    for (const name of ['inventory_saas_test; DROP DATABASE x', 'Inventory_test', 'a"b_test', 'a b_test', '_test']) {
      expect(() => assertTestDatabaseName(name)).toThrow();
    }
  });
});

describe('getTestDbConfig', () => {
  it('usa o banco de testes padrão e IGNORA DB_NAME do ambiente', () => {
    const cfg = getTestDbConfig(undefined, ENV);
    expect(cfg.database).toBe(DEFAULT_TEST_DB_NAME);
    expect(cfg.database).not.toBe(ENV.DB_NAME);
  });

  it('lê host, porta e credenciais do ambiente', () => {
    const cfg = getTestDbConfig(undefined, ENV);
    expect(cfg).toMatchObject({
      host: 'localhost',
      port: 5433,
      adminUser: 'postgres',
      adminPassword: 'admin-pw',
      appUser: 'inventory_saas_app',
      appPassword: 'app-pw',
    });
  });

  it('recusa apontar para um banco que não seja de teste', () => {
    expect(() => getTestDbConfig('inventory_saas', ENV)).toThrow(/_test/);
  });

  it('explica qual variável de ambiente está faltando', () => {
    expect(() => getTestDbConfig(undefined, { ...ENV, DB_ADMIN_PASSWORD: '' })).toThrow(/DB_ADMIN_PASSWORD/);
  });
});

describe('trava de segurança do host do banco de testes', () => {
  it('recusa um host remoto e diz qual host, por quê e como liberar', () => {
    expect(() => getTestDbConfig(undefined, { ...ENV, DB_HOST: 'db.example.com' })).toThrow(
      /db\.example\.com.*TEST_DB_ALLOW_REMOTE/s,
    );
  });

  it('aceita apenas hosts locais (localhost, 127.0.0.1, ::1) e trata DB_HOST ausente como localhost', () => {
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      expect(getTestDbConfig(undefined, { ...ENV, DB_HOST: host }).host).toBe(host);
    }
    expect(getTestDbConfig(undefined, { ...ENV, DB_HOST: undefined }).host).toBe('localhost');
  });

  it('aceita um host remoto somente com TEST_DB_ALLOW_REMOTE=1', () => {
    const remote = { ...ENV, DB_HOST: 'db.example.com' };
    expect(getTestDbConfig(undefined, { ...remote, TEST_DB_ALLOW_REMOTE: '1' }).host).toBe('db.example.com');
    expect(() => getTestDbConfig(undefined, { ...remote, TEST_DB_ALLOW_REMOTE: 'true' })).toThrow(/db\.example\.com/);
  });
});

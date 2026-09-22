import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Só host, porta e credenciais vêm do .env. O NOME do banco de teste NUNCA vem
// de DB_NAME: é a trava que impede os testes de escreverem no banco de desenvolvimento.
dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });

export const DEFAULT_TEST_DB_NAME = 'inventory_saas_test';

// Role criado só para os testes. Sem superusuário e sem BYPASSRLS, para que
// FORCE ROW LEVEL SECURITY valha para ele como em bancos gerenciados.
// A senha fixa é aceitável porque getTestDbConfig só libera hosts locais (ver LOCAL_HOSTS):
// o role só chega a existir no Postgres local de Docker, salvo opt-in explícito com TEST_DB_ALLOW_REMOTE=1.
export const TEST_OWNER_ROLE = 'inventory_saas_test_owner';
export const TEST_OWNER_PASSWORD = 'test_owner_local_only';

// Hosts em que o harness pode criar role e recriar bancos sem pedir confirmação.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

export interface TestDbConfig {
  host: string;
  port: number;
  adminUser: string; // superusuário: só cria/apaga bancos e semeia dados (ignora RLS)
  adminPassword: string;
  ownerUser: string; // dono do banco de teste: roda as migrations
  ownerPassword: string;
  appUser: string; // role de RUNTIME da aplicação: é nele que a RLS realmente vale
  appPassword: string;
  database: string;
}

// O nome vai interpolado em SQL (CREATE/DROP DATABASE não aceitam parâmetro),
// então o formato é estrito: minúsculas, dígitos e "_", terminando em "_test".
export function assertTestDatabaseName(name: string): void {
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Recusado: "${name}" não é um banco de testes. O nome precisa ser minúsculo, ` +
        `usar só letras/dígitos/"_" e terminar em "_test" (ex.: ${DEFAULT_TEST_DB_NAME}).`,
    );
  }
}

export function getTestDbConfig(
  database: string = DEFAULT_TEST_DB_NAME,
  env: NodeJS.ProcessEnv = process.env,
): TestDbConfig {
  assertTestDatabaseName(database);

  // O README manda apontar DB_HOST para um Postgres já em execução, então o .env pode
  // conter um host gerenciado/staging. O harness cria um role com senha fixa e recria
  // bancos como superusuário: só faz isso em host local, a menos que haja opt-in explícito.
  const host = env.DB_HOST || 'localhost';
  if (!LOCAL_HOSTS.includes(host) && env.TEST_DB_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Recusado: DB_HOST="${host}" não é um host local (${LOCAL_HOSTS.join(', ')}). Os testes de integração ` +
        `criam o role "${TEST_OWNER_ROLE}" com senha fixa e recriam bancos como superusuário. ` +
        `Se este host é mesmo descartável, libere-o de propósito com TEST_DB_ALLOW_REMOTE=1.`,
    );
  }

  for (const key of ['DB_ADMIN_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD']) {
    if (!env[key]) {
      throw new Error(`Variável ${key} ausente no backend/.env (necessária para os testes de integração).`);
    }
  }

  return {
    host,
    port: parseInt(env.DB_PORT || '5432', 10),
    adminUser: env.DB_ADMIN_USER || 'postgres',
    adminPassword: env.DB_ADMIN_PASSWORD!,
    ownerUser: TEST_OWNER_ROLE,
    ownerPassword: TEST_OWNER_PASSWORD,
    appUser: env.DB_APP_USER!,
    appPassword: env.DB_APP_PASSWORD!,
    database,
  };
}

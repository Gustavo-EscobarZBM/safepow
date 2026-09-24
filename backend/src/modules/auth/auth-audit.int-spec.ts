import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Company } from '../companies/company.entity';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { AuthService } from './auth.service';

/**
 * O harness imita um banco gerenciado (dono das tabelas sem superusuário, FORCE RLS), e nele o
 * auth_lookup_user_by_email (SECURITY DEFINER do dono) não enxerga usuários com empresa — problema
 * pré-existente, fora do SP2. Só a busca por e-mail é trocada pela mesma consulta feita na conexão
 * administrativa (a função roda como o dono, qualquer que seja quem chama); a auditoria
 * (dataSource.transaction) roda no role de runtime da aplicação, como em produção.
 */
async function service(): Promise<AuthService> {
  const ds = await appDataSource();
  const lookupAsAdmin = Object.assign(Object.create(ds) as DataSource, {
    query: (sql: string, params?: unknown[]) =>
      sql.includes('auth_lookup_user_by_email')
        ? adminQuery(
            `SELECT id, "companyId", "passwordHash", role, "isActive", name FROM users WHERE email = $1 LIMIT 1`,
            params,
          )
        : ds.query(sql, params),
  });
  return new AuthService(lookupAsAdmin, new JwtService({ secret: 'teste' }), ds.getRepository(Company));
}

describe('AuthService — auditoria de login (SP2)', () => {
  let companyId: string;
  let userId: string;
  const email = 'login-audit@teste.local';

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Login');
    userId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Ana', $1, $2, 'manager', $3) RETURNING id`,
        [email, await bcrypt.hash('senha-certa', 4), companyId],
      )
    )[0].id;
  });
  afterAll(() => closeTestConnections());

  it('login com sucesso grava "login" com ator, origem, IP e requestId', async () => {
    const requestId = randomUUID();

    await (await service()).login(email, 'senha-certa', { ip: '10.1.2.3', userAgent: 'Dart/3.5 (dart:io)', requestId });

    const rows = await adminQuery(
      `SELECT action, "entityType", "entityId", "actorUserId", source, ip, "requestId" FROM audit_log WHERE action LIKE 'login%'`,
    );
    expect(rows).toEqual([
      { action: 'login', entityType: 'session', entityId: userId, actorUserId: userId, source: 'mobile', ip: '10.1.2.3', requestId },
    ]);
  });

  it('senha errada grava "login_failed" (e o login continua recusando)', async () => {
    await expect((await service()).login(email, 'senha-errada', { userAgent: 'Mozilla/5.0' })).rejects.toThrow();

    const rows = await adminQuery(`SELECT action, source FROM audit_log WHERE action LIKE 'login%'`);
    expect(rows).toEqual([{ action: 'login_failed', source: 'web' }]);
  });

  it('e-mail inexistente: não grava nada (não há empresa a quem pertença)', async () => {
    await expect((await service()).login('ninguem@teste.local', 'x')).rejects.toThrow();
    expect(await adminQuery(`SELECT id FROM audit_log WHERE action LIKE 'login%'`)).toHaveLength(0);
  });
});

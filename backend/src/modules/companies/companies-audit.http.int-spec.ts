import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { TenantContextMiddleware } from '../../common/tenant/tenant-context.middleware';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { User, UserRole } from '../users/user.entity';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { Company } from './company.entity';

const JWT_SECRET = 'segredo-somente-de-teste';

async function startApp() {
  const ds = await appDataSource();
  const moduleRef = await Test.createTestingModule({
    controllers: [CompaniesController],
    providers: [
      CompaniesService,
      { provide: getRepositoryToken(Company), useValue: ds.getRepository(Company) },
      { provide: getRepositoryToken(User), useValue: ds.getRepository(User) },
      { provide: DataSource, useValue: ds },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const middleware = new TenantContextMiddleware(new JwtService({ secret: JWT_SECRET }), ds);
  app.use((req: Request, res: Response, next: NextFunction) => void middleware.use(req, res, next));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

async function send(baseUrl: string, method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, requestId: response.headers.get('x-request-id') };
}

describe('Painel Master — a auditoria registra quem fez (SP2)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let masterId: string;
  let masterToken: string;
  let companyId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    masterId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Master', 'master-audit@teste.local', 'x', 'master_admin', NULL) RETURNING id`,
      )
    )[0].id;
    masterToken = await new JwtService({ secret: JWT_SECRET }).signAsync({
      sub: masterId,
      role: UserRole.MASTER_ADMIN,
      companyId: null,
    });
    companyId = await seedCompany('Empresa do Master');
  });

  async function lastCompanyAudit(id: string) {
    const [row] = await adminQuery(
      `SELECT action, changes, "actorUserId", "actorName", source, "requestId", ip FROM audit_log
        WHERE "entityType" = 'company' AND "entityId" = $1 ORDER BY seq DESC LIMIT 1`,
      [id],
    );
    return row;
  }

  it.each([
    ['bloquear', 'PATCH', 'status', { status: 'blocked' }],
    ['editar dados', 'PATCH', '', { name: 'Empresa Renomeada' }],
  ])('%s grava o Master como autor, origem web, requestId e IP', async (_label, method, suffix, body) => {
    const { status, requestId } = await send(baseUrl, method, `/api/master/companies/${companyId}${suffix ? `/${suffix}` : ''}`, masterToken, body);

    expect(status).toBe(200);
    const audit = await lastCompanyAudit(companyId);
    expect(audit).toMatchObject({ action: 'update', actorUserId: masterId, actorName: 'Master', source: 'web', requestId });
    expect(audit.ip).not.toBeNull();
  });

  it('criar empresa grava o Master como autor da criação da empresa', async () => {
    const { status, body, requestId } = await send(baseUrl, 'POST', '/api/master/companies', masterToken, {
      name: 'Empresa Nova',
      managerName: 'Gerente Novo',
      managerEmail: 'novo-gerente@teste.local',
      managerPassword: 'senha123',
    });

    expect(status).toBe(201);
    expect(await lastCompanyAudit(body.id)).toMatchObject({
      action: 'create',
      actorUserId: masterId,
      source: 'web',
      requestId,
    });
  });
});

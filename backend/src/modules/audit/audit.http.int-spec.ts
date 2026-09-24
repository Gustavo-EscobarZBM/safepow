import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantContextMiddleware } from '../../common/tenant/tenant-context.middleware';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { UserRole } from '../users/user.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

const JWT_SECRET = 'segredo-somente-de-teste';

async function startApp() {
  const moduleRef = await Test.createTestingModule({ controllers: [AuditController], providers: [AuditService] })
    .overrideGuard(SubscriptionGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const middleware = new TenantContextMiddleware(new JwtService({ secret: JWT_SECRET }), await appDataSource());
  app.use((req: Request, res: Response, next: NextFunction) => void middleware.use(req, res, next));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

async function get(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  // text() descarta o BOM UTF-8 (decodificação WHATWG); decodificar os bytes crus o preserva para o teste do CSV.
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  return { status: response.status, body: isJson && text ? JSON.parse(text) : text, headers: response.headers };
}

describe('AuditController (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerToken: string;
  let employeeToken: string;
  let productId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa API Audit');
    const managerId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('G', 'g-audit@teste.local', 'x', 'manager', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const employeeId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('F', 'f-audit@teste.local', 'x', 'employee', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const jwt = new JwtService({ secret: JWT_SECRET });
    managerToken = await jwt.signAsync({ sub: managerId, role: UserRole.MANAGER, companyId });
    employeeToken = await jwt.signAsync({ sub: employeeId, role: UserRole.EMPLOYEE, companyId });
    productId = await seedProduct({ companyId, barcode: '1', name: 'Arroz; "tipo 1"', unitPrice: 10 });
    await adminQuery(`UPDATE products SET "unitPrice" = 12 WHERE id = $1`, [productId]);
  });

  it('lista mais recente primeiro, com total e paginação', async () => {
    const { status, body } = await get(baseUrl, '/api/audit?pageSize=2', managerToken);

    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 2 });
    expect(body.total).toBeGreaterThanOrEqual(4); // 2 usuários + produto create + update
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ entityType: 'product', action: 'update', entityLabel: 'Arroz; "tipo 1"' });
  });

  it('filtra por entidade (gaveta Histórico)', async () => {
    const { body } = await get(baseUrl, `/api/audit?entityType=product&entityId=${productId}`, managerToken);
    expect(body.items.map((i: { action: string }) => i.action)).toEqual(['update', 'create']);
  });

  it('filtra por ação e período', async () => {
    const { body } = await get(baseUrl, '/api/audit?action=create&from=2000-01-01T00:00:00Z&to=2999-01-01T00:00:00Z', managerToken);
    expect(body.items.every((i: { action: string }) => i.action === 'create')).toBe(true);
  });

  it.each(['pageSize=500', 'page=0', 'entityType=nave', 'action=explodir', 'from=ontem', 'entityId=nao-uuid', 'foo=bar', 'from=20260924', 'to=2026-W01'])(
    'GET /audit?%s ⇒ 400',
    async (query) => {
      const { status } = await get(baseUrl, `/api/audit?${query}`, managerToken);
      expect(status).toBe(400);
    },
  );

  it('só gerente (403 para funcionário)', async () => {
    expect((await get(baseUrl, '/api/audit', employeeToken)).status).toBe(403);
    expect((await get(baseUrl, '/api/audit/export', employeeToken)).status).toBe(403);
  });

  it('export CSV: BOM, ";" como separador, aspas escapadas, alterações legíveis', async () => {
    const { status, body, headers } = await get(baseUrl, `/api/audit/export?entityId=${productId}`, managerToken);

    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('text/csv');
    expect(headers.get('content-disposition')).toContain('attachment');
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = (body as string).slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Data/hora;Pessoa;Papel;Origem;Ação;Entidade;Registro;Alterações;Justificativa;IP');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Arroz; ""tipo 1"""');
    expect(lines[1]).toContain('unitPrice: 10 → 12');
  });

  it('export CSV neutraliza fórmulas (=, +, -, @) — o arquivo abre direto no Excel', async () => {
    const formulaId = await seedProduct({ companyId, barcode: '2', name: '=HYPERLINK("http://x";"clique")', unitPrice: 1 });

    const { body } = await get(baseUrl, `/api/audit/export?entityId=${formulaId}`, managerToken);

    const [, row] = (body as string).slice(1).trim().split('\r\n');
    expect(row).toContain(`"'=HYPERLINK(""http://x"";""clique"")"`);
    expect(row).not.toMatch(/;=HYPERLINK|;"=HYPERLINK/);
  });
});

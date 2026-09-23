import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantContextMiddleware } from '../../common/tenant/tenant-context.middleware';
import {
  adminQuery,
  appDataSource,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
} from '../../test-utils/test-db';
import { UserRole } from '../users/user.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

const JWT_SECRET = 'segredo-somente-de-teste';

/**
 * App Nest real (controller, guards de JWT/papel, ValidationPipe igual ao main.ts, TenantContextMiddleware
 * real sobre o Postgres de teste). Só o SubscriptionGuard é trocado — ele injeta o repositório de Company,
 * e a assinatura não é o que estes testes verificam.
 */
async function startApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProductsController],
    providers: [ProductsService],
  })
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

function tokenFor(ctx: { userId: string; companyId: string; role: UserRole }): Promise<string> {
  return new JwtService({ secret: JWT_SECRET }).signAsync({ sub: ctx.userId, role: ctx.role, companyId: ctx.companyId });
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function seedUser(companyId: string, role: 'manager' | 'employee'): Promise<string> {
  return (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [`Usuário ${role}`, `${role}-${companyId}@teste.local`, role, companyId],
    )
  )[0].id;
}

describe('ProductsController — contratos HTTP (etapa 1.3)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa HTTP');
    managerToken = await tokenFor({ userId: await seedUser(companyId, 'manager'), companyId, role: UserRole.MANAGER });
    employeeToken = await tokenFor({ userId: await seedUser(companyId, 'employee'), companyId, role: UserRole.EMPLOYEE });
  });

  it('POST /products com código de produto ARQUIVADO ⇒ 409 com errorCode e productId no corpo', async () => {
    const archivedId = await seedProduct({ companyId, barcode: '789' });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archivedId]);

    const { status, body } = await request(baseUrl, 'POST', '/api/products', managerToken, {
      barcode: '789',
      name: 'Arroz 5kg',
    });

    expect(status).toBe(409);
    expect(body).toEqual({
      statusCode: 409,
      errorCode: 'PRODUCT_ARCHIVED_EXISTS',
      message: 'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
      productId: archivedId,
    });
  });

  it('PATCH /products/:id/restore reativa e devolve o produto (200)', async () => {
    const productId = await seedProduct({ companyId, barcode: '790' });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);

    const { status, body } = await request(baseUrl, 'PATCH', `/api/products/${productId}/restore`, managerToken);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: productId, isActive: true });
  });

  it('PATCH /products/:id/restore é só para gerente (403 para funcionário)', async () => {
    const productId = await seedProduct({ companyId, barcode: '791' });

    const { status } = await request(baseUrl, 'PATCH', `/api/products/${productId}/restore`, employeeToken);

    expect(status).toBe(403);
  });

  it('GET /products/search responde a busca (a rota estática não cai em handler paramétrico)', async () => {
    await seedProduct({ companyId, barcode: '800', name: 'Arroz' });

    const { status, body } = await request(baseUrl, 'GET', '/api/products/search?q=arr&pageSize=5', managerToken);

    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 5 });
    expect(body.items[0]).toMatchObject({ name: 'Arroz', barcode: '800' });
  });

  it.each(['pageSize=500', 'page=0', 'page=abc', 'status=deleted', 'foo=bar'])(
    'GET /products/search?%s ⇒ 400 (validação da query)',
    async (query) => {
      const { status } = await request(baseUrl, 'GET', `/api/products/search?${query}`, managerToken);
      expect(status).toBe(400);
    },
  );

  it('GET /products/search é só para gerente (403 para funcionário)', async () => {
    const { status } = await request(baseUrl, 'GET', '/api/products/search', employeeToken);
    expect(status).toBe(403);
  });
});

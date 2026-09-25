import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { TenantContextMiddleware } from '../common/tenant/tenant-context.middleware';
import { LossesController } from '../modules/losses/losses.controller';
import { LossesService } from '../modules/losses/losses.service';
import { ProductsController } from '../modules/products/products.controller';
import { ProductsService } from '../modules/products/products.service';
import { UserRole } from '../modules/users/user.entity';
import { adminQuery, appDataSource } from './test-db';

export const APPROVAL_TEST_JWT_SECRET = 'segredo-somente-de-teste';

/**
 * App Nest real para os testes de aprovação (SP2, 2.2.1): controllers de Produtos e Perdas e — a partir da
 * Task 5 — os de aprovação, com o TenantContextMiddleware real. Só o SubscriptionGuard é trocado.
 */
export async function startApprovalsApp(
  extra: { controllers?: any[]; providers?: any[] } = {},
): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProductsController, LossesController, ...(extra.controllers ?? [])],
    providers: [ProductsService, LossesService, ...(extra.providers ?? [])],
  })
    .overrideGuard(SubscriptionGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const middleware = new TenantContextMiddleware(new JwtService({ secret: APPROVAL_TEST_JWT_SECRET }), await appDataSource());
  app.use((req: Request, res: Response, next: NextFunction) => void middleware.use(req, res, next));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

export function tokenFor(userId: string, companyId: string, role: UserRole = UserRole.MANAGER): Promise<string> {
  return new JwtService({ secret: APPROVAL_TEST_JWT_SECRET }).signAsync({ sub: userId, role, companyId });
}

export async function http(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

let userCounter = 0;
export async function seedUser(
  companyId: string,
  role: 'manager' | 'employee' = 'manager',
  options: { isActive?: boolean; name?: string } = {},
): Promise<string> {
  userCounter += 1;
  return (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId", "isActive") VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id`,
      [options.name ?? `Gerente ${userCounter}`, `u${userCounter}-${companyId}@teste.local`, role, companyId, options.isActive ?? true],
    )
  )[0].id;
}

export async function seedLoss(companyId: string, productId: string, reportedByUserId: string): Promise<string> {
  const reasonId = (await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId]))[0].id;
  const locationId = (await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId]))[0].id;
  return (
    await adminQuery(
      `INSERT INTO losses ("companyId","clientGeneratedId","productId","reportedByUserId","locationId","reasonId","occurredAt","quantity")
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, now(), 2) RETURNING id`,
      [companyId, productId, reportedByUserId, locationId, reasonId],
    )
  )[0].id;
}

export async function setPolicies(companyId: string, policies: Record<string, unknown>): Promise<void> {
  await adminQuery(`UPDATE companies SET "approvalPolicies" = $1::jsonb WHERE id = $2`, [JSON.stringify(policies), companyId]);
}

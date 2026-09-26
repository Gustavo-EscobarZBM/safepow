import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
// O arquivo de teste precisa ter feito jest.mock('@nestjs/bullmq', ...) com o bullmq-mock antes de importar isto.
import { getQueueToken } from '@nestjs/bullmq';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { TenantContextMiddleware } from '../common/tenant/tenant-context.middleware';
import { ImportJobsController } from '../modules/imports/import-jobs.controller';
import { IMPORTS_QUEUE, ImportJobsService } from '../modules/imports/import-jobs.service';
import { ImportMappingsController } from '../modules/imports/import-mappings.controller';
import { ImportMappingsService } from '../modules/imports/import-mappings.service';
import { StorageService } from '../modules/uploads/storage.service';
import { APPROVAL_TEST_JWT_SECRET } from './approvals-test-app';
import { appDataSource } from './test-db';

/** Object storage em memória. */
export class FakeStorage {
  readonly files = new Map<string, Buffer>();
  private counter = 0;

  async uploadBuffer(params: { companyId: string; folder: string; buffer: Buffer; originalName: string }) {
    this.counter += 1;
    const key = `${params.companyId}/${params.folder}/${this.counter}-${params.originalName}`;
    this.files.set(key, params.buffer);
    return { key, url: `memory://${key}` };
  }

  async downloadBuffer(key: string): Promise<Buffer> {
    const buffer = this.files.get(key);
    if (!buffer) throw new Error(`Arquivo ${key} não existe no storage falso.`);
    return buffer;
  }
}

/** Fila que só registra as mensagens (o teste roda o worker na mão). */
export class FakeQueue {
  readonly calls: { name: string; data: any; opts?: unknown }[] = [];
  async add(name: string, data: unknown, opts?: unknown) {
    this.calls.push({ name, data, opts });
    return { id: String(this.calls.length) };
  }
}

export async function startImportsApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
  storage: FakeStorage;
  queue: FakeQueue;
}> {
  const storage = new FakeStorage();
  const queue = new FakeQueue();
  const moduleRef = await Test.createTestingModule({
    controllers: [ImportJobsController, ImportMappingsController],
    providers: [
      ImportJobsService,
      ImportMappingsService,
      { provide: StorageService, useValue: storage },
      { provide: getQueueToken(IMPORTS_QUEUE), useValue: queue },
    ],
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
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1'), storage, queue };
}

export async function uploadFile(
  baseUrl: string,
  token: string,
  buffer: Buffer,
  fileName: string,
  resource: string | null = 'products',
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append('file', new Blob([buffer]), fileName);
  if (resource !== null) form.append('resource', resource);
  const response = await fetch(`${baseUrl}/api/imports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

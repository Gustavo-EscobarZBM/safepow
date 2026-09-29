jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { seedUser, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeStorage } from '../../test-utils/imports-test-app';
import { UserRole } from '../users/user.entity';
import { StorageService } from './storage.service';
import { UploadsController } from './uploads.controller';

describe('POST /uploads/product-image (SP4 4.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let token: string;
  const storage = new FakeStorage();

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp({
      controllers: [UploadsController],
      providers: [{ provide: StorageService, useValue: storage }],
    }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Fotos');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  function upload(type: string, asToken = token) {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('conteudo-da-imagem')], { type }), 'foto.bin');
    return fetch(`${baseUrl}/api/uploads/product-image`, { method: 'POST', headers: { Authorization: `Bearer ${asToken}` }, body: form });
  }

  it('gerente envia JPEG e recebe a URL, na pasta products', async () => {
    const response = await upload('image/jpeg');
    expect(response.status).toBe(201);
    expect(((await response.json()) as { url: string }).url).toEqual(expect.any(String));
    expect([...storage.files.keys()].at(-1)).toMatch(new RegExp(`^${companyId}/products/`));
  });

  it('HEIC é recusado com mensagem amigável', async () => {
    const response = await upload('image/heic');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toBe('Formato de imagem não suportado. Use JPEG, PNG ou WebP.');
  });

  it('funcionário não envia foto de produto', async () => {
    const employee = await tokenFor(await seedUser(companyId, 'employee'), companyId, UserRole.EMPLOYEE);
    expect((await upload('image/png', employee)).status).toBe(403);
  });
});

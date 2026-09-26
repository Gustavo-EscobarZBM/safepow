jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { startImportsApp } from '../../test-utils/imports-test-app';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { headerFingerprint } from './engine/mapping';

describe('/import-mappings — mapeamentos salvos (SP3, 3.1.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let token: string;

  const payload = {
    resource: 'products',
    name: 'ERP X',
    mapping: { barcode: 'EAN', name: 'Descrição' },
    headers: ['EAN', 'Descrição', 'Obs'],
  };

  beforeAll(async () => {
    ({ app, baseUrl } = await startImportsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Mapeamentos');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  it('cria com o fingerprint dos cabeçalhos; mesmo nome substitui', async () => {
    const created = await http(baseUrl, 'POST', '/api/import-mappings', token, payload);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'ERP X', resource: 'products', headerFingerprint: headerFingerprint(payload.headers) });

    await http(baseUrl, 'POST', '/api/import-mappings', token, { ...payload, mapping: { barcode: 'EAN', name: 'Obs' } });
    const rows = await adminQuery(`SELECT mapping FROM import_mappings WHERE "companyId" = $1`, [companyId]);
    expect(rows).toEqual([{ mapping: { barcode: 'EAN', name: 'Obs' } }]);
  });

  it('lista por recurso e exclui', async () => {
    const { body: created } = await http(baseUrl, 'POST', '/api/import-mappings', token, payload);
    const list = await http(baseUrl, 'GET', '/api/import-mappings?resource=products', token);
    expect(list.status).toBe(200);
    expect(list.body.map((m: { name: string }) => m.name)).toEqual(['ERP X']);

    const removed = await http(baseUrl, 'DELETE', `/api/import-mappings/${created.id}`, token);
    expect([200, 204]).toContain(removed.status);
    expect((await http(baseUrl, 'GET', '/api/import-mappings?resource=products', token)).body).toEqual([]);
  });

  it('campo desconhecido ⇒ 400 MAPPING_INVALID', async () => {
    const { status, body } = await http(baseUrl, 'POST', '/api/import-mappings', token, {
      ...payload,
      mapping: { barcode: 'EAN', cor: 'Descrição' },
    });
    expect(status).toBe(400);
    expect(body.errorCode).toBe('MAPPING_INVALID');
  });

  it('não enxerga mapeamentos de outra empresa', async () => {
    const other = await seedCompany('Outra');
    await http(baseUrl, 'POST', '/api/import-mappings', await tokenFor(await seedUser(other), other), payload);
    expect((await http(baseUrl, 'GET', '/api/import-mappings?resource=products', token)).body).toEqual([]);
  });
});

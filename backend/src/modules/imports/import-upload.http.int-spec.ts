jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import { http, seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { UserRole } from '../users/user.entity';
import { headerFingerprint } from './engine/mapping';
import { csvBuffer, xlsxBuffer, zipWithDeclaredSize } from './engine/test-fixtures';

const ERP_HEADERS = ['Cód. Barras', 'Descrição', 'Preço de Venda', 'Custo'];

async function erpSpreadsheet(rows = 30): Promise<Buffer> {
  const data = Array.from({ length: rows }, (_, i) => [`789${String(i).padStart(10, '0')}`, `Produto ${i}`, '10,50', '6,00']);
  return xlsxBuffer({ Produtos: [ERP_HEADERS, ...data], Aba2: [['EAN', 'Nome'], ['1', 'X']] });
}

describe('POST /imports — upload com prévia (SP3, 3.1.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let companyId: string;
  let managerId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl, storage } = await startImportsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Importação');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
  });

  it('xlsx: cria o job uploaded, guarda o arquivo e devolve amostra, sugestão e campos', async () => {
    const buffer = await erpSpreadsheet();
    const { status, body } = await uploadFile(baseUrl, token, buffer, 'erp.xlsx');

    expect(status).toBe(201);
    expect(body.job).toMatchObject({
      status: 'uploaded',
      format: 'xlsx',
      resource: 'products',
      fileName: 'erp.xlsx',
      createdByUserId: managerId,
      sheetName: 'Produtos',
      headers: ERP_HEADERS,
    });
    expect(body.job.fileHash).toBe(createHash('sha256').update(buffer).digest('hex'));
    expect(body.sheets).toEqual(['Produtos', 'Aba2']);
    expect(body.headers).toEqual(ERP_HEADERS);
    expect(body.sample).toHaveLength(20);
    expect(body.suggestedMapping).toEqual({
      barcode: 'Cód. Barras',
      name: 'Descrição',
      unitPrice: 'Preço de Venda',
      costPrice: 'Custo',
    });
    expect(body.matchedMapping).toBeNull();
    expect(body.duplicateOf).toBeNull();
    expect(body.fields).toHaveLength(5);
    expect(storage.files.get(body.job.storageKey)?.equals(buffer)).toBe(true);
  });

  it('csv Windows-1252 com ;', async () => {
    const buffer = csvBuffer(
      [
        ['Código de barras', 'Descrição', 'Preço'],
        ['1', 'Feijão', '1.234,56'],
      ],
      { delimiter: ';', encoding: 'windows-1252' },
    );
    const { status, body } = await uploadFile(baseUrl, token, buffer, 'erp.csv');
    expect(status).toBe(201);
    expect(body.job).toMatchObject({ format: 'csv', encoding: 'windows-1252', delimiter: ';' });
    expect(body.headers).toEqual(['Código de barras', 'Descrição', 'Preço']);
    expect(body.sample).toEqual([['1', 'Feijão', '1.234,56']]);
    expect(body.sheets).toEqual([]);
  });

  it.each<[string, () => Buffer | Promise<Buffer>, string]>([
    ['binário', () => Buffer.from([0x47, 0x49, 0x46, 0x00, 0x01]), 'UNSUPPORTED_FILE'],
    ['zip bomb', () => zipWithDeclaredSize(300 * 1024 * 1024), 'FILE_TOO_LARGE_UNCOMPRESSED'],
  ])('%s ⇒ 400 %s', async (_name, make, errorCode) => {
    const { status, body } = await uploadFile(baseUrl, token, await make(), 'x.xlsx');
    expect(status).toBe(400);
    expect(body.errorCode).toBe(errorCode);
  });

  it('sem arquivo ⇒ 400', async () => {
    const response = await fetch(`${baseUrl}/api/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: new FormData(),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toBe('Nenhum arquivo enviado (campo "file").');
  });

  it('recurso desconhecido ⇒ 400', async () => {
    const { status, body } = await uploadFile(baseUrl, token, await erpSpreadsheet(1), 'x.xlsx', 'users');
    expect(status).toBe(400);
    expect(body.message).toBe('Tipo de importação desconhecido.');
  });

  it('acima de 20 MB ⇒ recusado', async () => {
    const { status } = await uploadFile(baseUrl, token, Buffer.alloc(21 * 1024 * 1024, 0x41), 'big.csv');
    expect([400, 413]).toContain(status);
  });

  it('mesma planilha já importada pela empresa ⇒ duplicateOf; de outra empresa ⇒ null', async () => {
    const buffer = await erpSpreadsheet(2);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const other = await seedCompany('Outra');
    await adminQuery(
      `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status, "fileHash") VALUES ($1, 'outra.xlsx', 'k', 'completed', $2)`,
      [other, hash],
    );
    expect((await uploadFile(baseUrl, token, buffer, 'a.xlsx')).body.duplicateOf).toBeNull();

    const [previous] = await adminQuery(
      `INSERT INTO import_jobs ("companyId", "fileName", "storageKey", status, "fileHash", "createdByUserId", "appliedAt")
       VALUES ($1, 'antes.xlsx', 'k', 'completed', $2, $3, now()) RETURNING id`,
      [companyId, hash, managerId],
    );
    const { body } = await uploadFile(baseUrl, token, buffer, 'a.xlsx');
    expect(body.duplicateOf).toMatchObject({ jobId: previous.id, fileName: 'antes.xlsx' });
    expect(body.duplicateOf.createdByName).toEqual(expect.any(String));
    expect(body.duplicateOf.appliedAt).toEqual(expect.any(String));
  });

  it('mapeamento salvo com os mesmos cabeçalhos é reconhecido e vira a sugestão', async () => {
    const saved = { barcode: 'Cód. Barras', name: 'Descrição', costPrice: 'Preço de Venda' };
    const [row] = await adminQuery(
      `INSERT INTO import_mappings ("companyId", resource, name, mapping, "headerFingerprint")
       VALUES ($1, 'products', 'ERP X', $2, $3) RETURNING id`,
      [companyId, JSON.stringify(saved), headerFingerprint([' custo', 'PRECO DE VENDA', 'descricao', 'cod barras'])],
    );
    const { body } = await uploadFile(baseUrl, token, await erpSpreadsheet(2), 'a.xlsx');
    expect(body.matchedMapping).toEqual({ id: row.id, name: 'ERP X' });
    expect(body.suggestedMapping).toEqual(saved);
  });

  it('funcionário ⇒ 403', async () => {
    const employee = await seedUser(companyId, 'employee');
    const employeeToken = await tokenFor(employee, companyId, UserRole.EMPLOYEE);
    expect((await uploadFile(baseUrl, employeeToken, await erpSpreadsheet(1), 'a.xlsx')).status).toBe(403);
  });

  it('POST /imports/:id/preview troca a aba e grava sheetName/headers; aba inexistente ⇒ 400', async () => {
    const { body: uploaded } = await uploadFile(baseUrl, token, await erpSpreadsheet(2), 'a.xlsx');
    const { status, body } = await http(baseUrl, 'POST', `/api/imports/${uploaded.job.id}/preview`, token, { sheetName: 'Aba2' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ headers: ['EAN', 'Nome'], sample: [['1', 'X']], suggestedMapping: { barcode: 'EAN', name: 'Nome' } });
    const [job] = await adminQuery(`SELECT "sheetName", headers FROM import_jobs WHERE id = $1`, [uploaded.job.id]);
    expect(job).toEqual({ sheetName: 'Aba2', headers: ['EAN', 'Nome'] });

    const missing = await http(baseUrl, 'POST', `/api/imports/${uploaded.job.id}/preview`, token, { sheetName: 'Nope' });
    expect(missing.status).toBe(400);
    expect(missing.body.errorCode).toBe('UNSUPPORTED_FILE');
  });

  it('preview durante a simulação ⇒ 409 INVALID_STATE', async () => {
    const { body: uploaded } = await uploadFile(baseUrl, token, await erpSpreadsheet(2), 'a.xlsx');
    await adminQuery(`UPDATE import_jobs SET status = 'simulating' WHERE id = $1`, [uploaded.job.id]);
    const { status, body } = await http(baseUrl, 'POST', `/api/imports/${uploaded.job.id}/preview`, token, { sheetName: 'Aba2' });
    expect(status).toBe(409);
    expect(body.errorCode).toBe('INVALID_STATE');
  });

  it('preview de job já aplicado ⇒ 409 INVALID_STATE', async () => {
    const { body: uploaded } = await uploadFile(baseUrl, token, await erpSpreadsheet(2), 'a.xlsx');
    await adminQuery(`UPDATE import_jobs SET status = 'completed', "appliedAt" = now() WHERE id = $1`, [uploaded.job.id]);
    const { status, body } = await http(baseUrl, 'POST', `/api/imports/${uploaded.job.id}/preview`, token, { sheetName: 'Aba2' });
    expect(status).toBe(409);
    expect(body.errorCode).toBe('INVALID_STATE');
  });

  it('GET /imports/:id de outra empresa ⇒ 404', async () => {
    const { body: uploaded } = await uploadFile(baseUrl, token, await erpSpreadsheet(1), 'a.xlsx');
    const other = await seedCompany('Outra');
    const otherToken = await tokenFor(await seedUser(other), other);
    expect((await http(baseUrl, 'GET', `/api/imports/${uploaded.job.id}`, token)).status).toBe(200);
    const { status, body } = await http(baseUrl, 'GET', `/api/imports/${uploaded.job.id}`, otherToken);
    expect(status).toBe(404);
    expect(body.message).toBe('Importação não encontrada.');
  });
});

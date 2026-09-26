jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedLoss, seedUser, setPolicies, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { csvBuffer, xlsxBuffer } from './engine/test-fixtures';
import { ImportSimulator } from './import-simulator';

const MAPPING = { barcode: 'EAN', name: 'Descrição', unitPrice: 'Preço' };

/** Planilha que exercita todas as ações; linha 8 em branco. */
const ROWS: unknown[][] = [
  ['EAN', 'Descrição', 'Preço'],
  ['1234567', 'Novo', '3,00'], // 2 create (aviso GTIN_LENGTH_SUSPECT)
  ['100', 'Arroz', '12,00'], // 3 update
  ['200', 'Feijão', '7,00'], // 4 reactivate
  ['300', 'Óleo', '5,00'], // 5 unchanged
  ['600', '', '1'], // 6 erro: sem nome
  ['700', 'Leite', 'abc'], // 7 erro: preço inválido (produto existe e NÃO é ausente)
  [], // 8 em branco
  ['1234567', 'Novo', '3,00'], // 9 duplicate idêntica
  ['100', 'Arroz', '99'], // 10 erro: repetida com dados diferentes
];

describe('Simulação da importação (SP3, 3.1.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let queue: FakeQueue;
  let companyId: string;
  let managerId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl, storage, queue } = await startImportsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    queue.calls.length = 0;
    companyId = await seedCompany('Empresa Simulação');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
  });

  const simulator = async (limits?: { maxRows: number }) =>
    new ImportSimulator(await appDataSource(), storage as unknown as StorageService, limits);

  async function seedCatalog(): Promise<void> {
    await seedProduct({ companyId, barcode: '100', name: 'Arroz', unitPrice: 10 });
    const bean = await seedProduct({ companyId, barcode: '200', name: 'Feijão', unitPrice: 7 });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [bean]);
    await seedProduct({ companyId, barcode: '300', name: 'Óleo', unitPrice: 5 });
    const missing = await seedProduct({ companyId, barcode: '400', name: 'Sal', unitPrice: 2 });
    await seedLoss(companyId, missing, managerId);
    const archived = await seedProduct({ companyId, barcode: '500', name: 'Arquivado', unitPrice: 1 });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archived]);
    await seedProduct({ companyId, barcode: '700', name: 'Leite', unitPrice: 4 });
  }

  async function upload(rows: unknown[][] = ROWS, fileName = 'erp.xlsx', buffer?: Buffer): Promise<string> {
    const { status, body } = await uploadFile(baseUrl, token, buffer ?? (await xlsxBuffer({ Produtos: rows })), fileName);
    expect(status).toBe(201);
    return body.job.id;
  }

  async function simulate(jobId: string, body: Record<string, unknown> = {}) {
    return http(baseUrl, 'POST', `/api/imports/${jobId}/simulate`, token, {
      mapping: MAPPING,
      updateFields: ['name', 'unitPrice'],
      ...body,
    });
  }

  async function simulateAndRun(jobId: string, body: Record<string, unknown> = {}) {
    const response = await simulate(jobId, body);
    expect(response.status).toBe(202);
    await (await simulator()).run(queue.calls[queue.calls.length - 1].data);
    return (await http(baseUrl, 'GET', `/api/imports/${jobId}`, token)).body;
  }

  const productsSnapshot = () =>
    adminQuery(`SELECT barcode, name, "unitPrice", "isActive", "updatedAt" FROM products WHERE "companyId" = $1 ORDER BY barcode`, [
      companyId,
    ]);

  it('simula todas as ações sem tocar em produtos', async () => {
    await seedCatalog();
    const before = await productsSnapshot();
    const jobId = await upload();

    const response = await simulate(jobId);
    expect(response.status).toBe(202);
    expect(response.body.job.status).toBe('simulating');
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]).toMatchObject({ name: 'simulate', data: { jobId, companyId, runId: expect.any(String) } });

    await (await simulator()).run(queue.calls[0].data);
    const job = (await http(baseUrl, 'GET', `/api/imports/${jobId}`, token)).body;

    expect(job.status).toBe('simulated');
    expect(job.simulatedAt).toEqual(expect.any(String));
    expect(job.summary).toMatchObject({
      totalRows: 8,
      counts: { create: 1, update: 1, reactivate: 1, unchanged: 1, error: 3, duplicate: 1, archive: 0 },
      missingCount: 1,
      sensitive: { priceChange: 0, archiveWithHistory: 1 },
    });
    expect(job.summary.warnings).toMatchObject({ GTIN_LENGTH_SUSPECT: 2, DUPLICATE_IDENTICAL: 1 });
    expect(job.errorReport.map((e: { row: number }) => e.row)).toEqual([6, 7, 10]);
    expect(storage.files.has(job.errorReportKey)).toBe(true);
    expect(await productsSnapshot()).toEqual(before);
  });

  it('linhas paginadas e filtradas por ação ou avisos', async () => {
    await seedCatalog();
    const jobId = await upload();
    await simulateAndRun(jobId);

    const update = await http(baseUrl, 'GET', `/api/imports/${jobId}/rows?action=update`, token);
    expect(update.body.total).toBe(1);
    expect(update.body.items[0]).toMatchObject({ rowNumber: 3, key: '100', diff: { unitPrice: { from: 10, to: 12 } } });

    const warnings = await http(baseUrl, 'GET', `/api/imports/${jobId}/rows?action=warnings`, token);
    expect(warnings.body.items.map((r: { rowNumber: number }) => r.rowNumber)).toEqual([2, 9]);

    const page = await http(baseUrl, 'GET', `/api/imports/${jobId}/rows?limit=2&page=2`, token);
    expect(page.body.total).toBe(8);
    expect(page.body.items.map((r: { rowNumber: number }) => r.rowNumber)).toEqual([4, 5]);

    const errors = await http(baseUrl, 'GET', `/api/imports/${jobId}/rows?action=error`, token);
    expect(errors.body.items.find((r: { rowNumber: number }) => r.rowNumber === 10).errors).toEqual([
      'Código repetido na linha 3 com dados diferentes.',
    ]);
  });

  it('ausentes: produto ativo fora da planilha, com o sinal de perdas; linha com erro não conta como ausente', async () => {
    await seedCatalog();
    const jobId = await upload();
    await simulateAndRun(jobId);
    const { body } = await http(baseUrl, 'GET', `/api/imports/${jobId}/missing`, token);
    expect(body).toEqual({ total: 1, items: [{ id: expect.any(String), key: '400', name: 'Sal', hasLosses: true }] });
  });

  it('política de preço ligada marca a mudança sensível', async () => {
    await seedCatalog();
    await setPolicies(companyId, { price_change: { enabled: true, thresholdPercent: 10 } });
    const jobId = await upload();
    const job = await simulateAndRun(jobId);
    expect(job.summary.sensitive.priceChange).toBe(1);
  });

  it('só os campos escolhidos entram no diff; campo não mapeado nunca', async () => {
    await seedProduct({ companyId, barcode: '100', name: 'Arroz', unitPrice: 10, costPrice: 6 });
    const jobId = await upload([
      ['EAN', 'Descrição', 'Preço'],
      ['100', 'Outro nome', '12,00'],
    ]);
    await simulateAndRun(jobId, { updateFields: ['unitPrice'] });
    const { body } = await http(baseUrl, 'GET', `/api/imports/${jobId}/rows`, token);
    expect(body.items[0].diff).toEqual({ unitPrice: { from: 10, to: 12 } });
  });

  it('CSV Windows-1252 com ; e preço brasileiro', async () => {
    const buffer = csvBuffer(
      [
        ['EAN', 'Descrição', 'Preço'],
        ['9', 'Feijão', '1.234,56'],
      ],
      { delimiter: ';', encoding: 'windows-1252' },
    );
    const jobId = await upload(undefined, 'erp.csv', buffer);
    await simulateAndRun(jobId);
    const { body } = await http(baseUrl, 'GET', `/api/imports/${jobId}/rows`, token);
    expect(body.items[0]).toMatchObject({ action: 'create', normalized: { barcode: '9', name: 'Feijão', unitPrice: 1234.56 } });
  });

  it('relatório CSV com as linhas de erro', async () => {
    await seedCatalog();
    const jobId = await upload();
    await simulateAndRun(jobId);
    const response = await fetch(`${baseUrl}/api/imports/${jobId}/report.csv`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const text = await response.text();
    expect(text).toContain('Nome do produto vazio.');
    expect(text).toContain('Preço inválido: ""abc"".');
    // fetch/TextDecoder descarta o BOM: a primeira linha começa direto no cabeçalho.
    expect(text.split(String.fromCharCode(13, 10))[0].replace(String.fromCharCode(0xfeff), '')).toBe('Linha;Código de barras;Nome;Situação;Erros;Avisos;EAN;Descrição;Preço');
  });

  it('relatório antes da simulação ⇒ 404', async () => {
    const jobId = await upload();
    const response = await fetch(`${baseUrl}/api/imports/${jobId}/report.csv`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(404);
  });

  it('saveMappingAs salva o mapeamento com o fingerprint dos cabeçalhos', async () => {
    const jobId = await upload();
    await simulate(jobId, { saveMappingAs: 'ERP X' });
    const rows = await adminQuery(`SELECT name, mapping FROM import_mappings WHERE "companyId" = $1`, [companyId]);
    expect(rows).toEqual([{ name: 'ERP X', mapping: MAPPING }]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['sem nome mapeado', { mapping: { barcode: 'EAN' } }, 'Mapeie as colunas obrigatórias: Código de barras e Nome.'],
    ['coluna inexistente', { mapping: { ...MAPPING, costPrice: 'Custo' } }, 'A coluna "Custo" não existe na planilha.'],
    ['código de barras em updateFields', { updateFields: ['barcode'] }, 'O campo "barcode" não pode ser atualizado.'],
    ['campo não mapeado em updateFields', { updateFields: ['costPrice'] }, 'O campo "costPrice" não está mapeado.'],
    ['mesma coluna em dois campos', { mapping: { ...MAPPING, sku: 'EAN' } }, 'A coluna "EAN" foi usada em mais de um campo.'],
  ])('%s ⇒ 400 MAPPING_INVALID', async (_name, body, message) => {
    const jobId = await upload();
    const { status, body: error } = await simulate(jobId, body);
    expect(status).toBe(400);
    expect(error).toMatchObject({ errorCode: 'MAPPING_INVALID', message });
    expect(queue.calls).toHaveLength(0);
  });

  it('aba cujo cabeçalho não tem a coluna mapeada ⇒ 400 antes de enfileirar', async () => {
    const { body } = await uploadFile(
      baseUrl,
      token,
      await xlsxBuffer({ Produtos: ROWS, Outra: [['Código', 'Nome']] }),
      'a.xlsx',
    );
    const { status } = await simulate(body.job.id, { sheetName: 'Outra' });
    expect(status).toBe(400);
    expect(queue.calls).toHaveLength(0);
  });

  it('job concluído ⇒ 409 INVALID_STATE', async () => {
    const jobId = await upload();
    await adminQuery(`UPDATE import_jobs SET status = 'completed' WHERE id = $1`, [jobId]);
    const { status, body } = await simulate(jobId);
    expect(status).toBe(409);
    expect(body.errorCode).toBe('INVALID_STATE');
  });

  it('mensagem velha (simulação substituída) não toca o job', async () => {
    await seedCatalog();
    const jobId = await upload();
    await simulate(jobId);
    await simulate(jobId, { updateFields: ['unitPrice'] });
    const [first, second] = queue.calls.map((c) => c.data);
    expect(first.runId).not.toBe(second.runId);

    await (await simulator()).run(first);
    const [stale] = await adminQuery(`SELECT status, options FROM import_jobs WHERE id = $1`, [jobId]);
    expect(stale.status).toBe('simulating');
    expect(stale.options.runId).toBe(second.runId);
    expect(await adminQuery(`SELECT 1 FROM import_rows WHERE "jobId" = $1`, [jobId])).toHaveLength(0);

    await (await simulator()).run(second);
    expect((await adminQuery(`SELECT status FROM import_jobs WHERE id = $1`, [jobId]))[0].status).toBe('simulated');
  });

  it('a mesma mensagem entregue duas vezes ao mesmo tempo (redelivery do BullMQ) não duplica linhas', async () => {
    await seedCatalog();
    const jobId = await upload();
    await simulate(jobId);
    const data = queue.calls[0].data;

    // Cada execução para no download até as duas terem passado pela transação inicial.
    const releases: (() => void)[] = [];
    let arrived = 0;
    let bothArrived!: () => void;
    const bothAtGate = new Promise<void>((resolve) => (bothArrived = resolve));
    const gated = {
      uploadBuffer: storage.uploadBuffer.bind(storage),
      downloadBuffer: async (key: string) => {
        arrived += 1;
        if (arrived === 2) bothArrived();
        await new Promise<void>((resolve) => releases.push(resolve));
        return storage.downloadBuffer(key);
      },
    } as unknown as StorageService;
    const ds = await appDataSource();
    const runs = Promise.all([new ImportSimulator(ds, gated).run(data), new ImportSimulator(ds, gated).run(data)]);
    await bothAtGate;
    releases.forEach((release) => release());
    await runs;

    const rows = await adminQuery(`SELECT "rowNumber" FROM import_rows WHERE "jobId" = $1`, [jobId]);
    expect(rows).toHaveLength(8);
    const [job] = await adminQuery(`SELECT status, summary FROM import_jobs WHERE id = $1`, [jobId]);
    expect(job.status).toBe('simulated');
    expect(job.summary.totalRows).toBe(8);
  });

  it('simular de novo apaga as linhas da simulação anterior', async () => {
    await seedCatalog();
    const jobId = await upload();
    await simulateAndRun(jobId);
    await simulateAndRun(jobId);
    expect(await adminQuery(`SELECT 1 FROM import_rows WHERE "jobId" = $1`, [jobId])).toHaveLength(8);
  });

  it('acima do limite de linhas ⇒ failed com mensagem', async () => {
    const rows = [['EAN', 'Descrição', 'Preço'], ...Array.from({ length: 6 }, (_, i) => [String(i + 1), `P${i}`, '1'])];
    const jobId = await upload(rows);
    await simulate(jobId);
    await (await simulator({ maxRows: 5 })).run(queue.calls[0].data);
    const [job] = await adminQuery(`SELECT status, "lastError" FROM import_jobs WHERE id = $1`, [jobId]);
    expect(job).toEqual({ status: 'failed', lastError: 'A planilha tem mais de 5 linhas.' });
  });
});

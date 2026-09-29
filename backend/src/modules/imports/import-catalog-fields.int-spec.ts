jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import { http, seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { FakeQueue, FakeStorage, startImportsApp, uploadFile } from '../../test-utils/imports-test-app';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, seedProduct, truncateAll, withTenant } from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { xlsxBuffer } from './engine/test-fixtures';
import { productsImportHandler } from './handlers/products.import-handler';
import { ImportApplier } from './import-applier';
import { ImportSimulator } from './import-simulator';

const HEADER = ['EAN', 'Descrição', 'Custo', 'Categoria', 'Marca', 'Fornecedor', 'Unidade', 'Perecível', 'Validade'];
const MAPPING = {
  barcode: 'EAN',
  name: 'Descrição',
  costPrice: 'Custo',
  category: 'Categoria',
  brand: 'Marca',
  supplier: 'Fornecedor',
  unit: 'Unidade',
  isPerishable: 'Perecível',
  shelfLifeDays: 'Validade',
};
const UPDATE_FIELDS = ['name', 'costPrice', 'category', 'brand', 'supplier', 'unit', 'isPerishable', 'shelfLifeDays'];

describe('Importação com dados de catálogo (SP4 4.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let storage: FakeStorage;
  let queue: FakeQueue;
  let companyId: string;
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
    companyId = await seedCompany('Empresa Importa Catálogo');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  async function simulated(rows: unknown[][]): Promise<string> {
    const { body } = await uploadFile(baseUrl, token, await xlsxBuffer({ Produtos: [HEADER, ...rows] }), 'erp.xlsx');
    const jobId = body.job.id;
    await http(baseUrl, 'POST', `/api/imports/${jobId}/simulate`, token, { mapping: MAPPING, updateFields: UPDATE_FIELDS });
    await new ImportSimulator(await appDataSource(), storage as unknown as StorageService).run(queue.calls[queue.calls.length - 1].data);
    return jobId;
  }

  async function apply(jobId: string): Promise<void> {
    await adminQuery(`UPDATE import_jobs SET status = 'applying', options = options || $2::jsonb WHERE id = $1`, [
      jobId,
      JSON.stringify({ applyRunId: 'r1', applyStartedAt: new Date().toISOString() }),
    ]);
    await new ImportApplier(await appDataSource()).run({ jobId, companyId, runId: 'r1' });
  }

  const productRow = async (barcode: string) =>
    (
      await adminQuery(
        `SELECT p."costPrice", p.unit, p."isPerishable", p."shelfLifeDays", c.name AS category, b.name AS brand, s.name AS supplier
           FROM products p
           LEFT JOIN categories c ON c.id = p."categoryId"
           LEFT JOIN brands b ON b.id = p."brandId"
           LEFT JOIN suppliers s ON s.id = p."supplierId"
          WHERE p."companyId" = $1 AND p.barcode = $2`,
        [companyId, barcode],
      )
    )[0];

  it('avisa na simulação o que será criado e cria na gravação, reaproveitando nomes com outra caixa', async () => {
    await adminQuery(`INSERT INTO brands ("companyId", name) VALUES ($1, 'Coca-Cola')`, [companyId]);
    const jobId = await simulated([
      ['111', 'Refri Cola 2L', '3,1234', 'Mercearia > Bebidas', 'coca-cola', 'Distribuidora Sul', 'un', 'Sim', '180'],
      ['222', 'Patinho', '25,5', 'Açougue', 'Friboi', 'Distribuidora Sul', 'Kilo', 'sim', '3'],
    ]);

    const [summary] = await adminQuery(`SELECT summary FROM import_jobs WHERE id = $1`, [jobId]);
    expect(summary.summary.warnings).toMatchObject({ CATEGORY_WILL_BE_CREATED: 2, BRAND_WILL_BE_CREATED: 1, SUPPLIER_WILL_BE_CREATED: 2 });

    await apply(jobId);

    expect(await productRow('111')).toEqual({
      costPrice: '3.1234',
      unit: 'UN',
      isPerishable: true,
      shelfLifeDays: 180,
      category: 'Bebidas',
      brand: 'Coca-Cola',
      supplier: 'Distribuidora Sul',
    });
    expect(await productRow('222')).toMatchObject({ unit: 'KG', category: 'Açougue', brand: 'Friboi', supplier: 'Distribuidora Sul' });
    expect(await adminQuery(`SELECT name FROM brands WHERE "companyId" = $1 ORDER BY name`, [companyId])).toEqual([
      { name: 'Coca-Cola' },
      { name: 'Friboi' },
    ]);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM suppliers WHERE "companyId" = $1`, [companyId])).toEqual([{ n: 1 }]);
    const categories = await adminQuery(
      `SELECT c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c."parentId" WHERE c."companyId" = $1 ORDER BY c.name`,
      [companyId],
    );
    expect(categories).toEqual([
      { name: 'Açougue', parent: null },
      { name: 'Bebidas', parent: 'Mercearia' },
      { name: 'Mercearia', parent: null },
    ]);
  });

  it('categoria "bebidas" reaproveita "Bebidas" existente e marca arquivada é reativada', async () => {
    const [bebidas] = await adminQuery(`INSERT INTO categories ("companyId", name) VALUES ($1, 'Bebidas') RETURNING id`, [companyId]);
    await adminQuery(`INSERT INTO brands ("companyId", name, "isActive") VALUES ($1, 'Antiga', false)`, [companyId]);
    const jobId = await simulated([['333', 'Suco', '2', 'bebidas', 'antiga', '', '', '', '']]);
    const [simulation] = await adminQuery(`SELECT summary FROM import_jobs WHERE id = $1`, [jobId]);
    expect(simulation.summary.warnings).toMatchObject({ BRAND_WILL_BE_REACTIVATED: 1 });
    expect(simulation.summary.warnings.BRAND_WILL_BE_CREATED).toBeUndefined();
    await apply(jobId);

    const [row] = await adminQuery(`SELECT "categoryId" FROM products WHERE barcode = '333'`);
    expect(row.categoryId).toBe(bebidas.id);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM categories`)).toEqual([{ n: 1 }]);
    expect(await adminQuery(`SELECT "isActive" FROM brands WHERE name = 'Antiga'`)).toEqual([{ isActive: true }]);
  });

  it('marca arquivada que o produto já usa e não muda continua arquivada (planilha mensal do ERP)', async () => {
    const productId = await seedProduct({ companyId, barcode: '777', name: 'Biscoito', costPrice: 2 });
    const [brand] = await adminQuery(`INSERT INTO brands ("companyId", name, "isActive") VALUES ($1, 'Velha', false) RETURNING id`, [companyId]);
    await adminQuery(`UPDATE products SET "brandId" = $1 WHERE id = $2`, [brand.id, productId]);

    const jobId = await simulated([['777', 'Biscoito', '2,50', '', 'Velha', '', '', '', '']]);
    const [simulation] = await adminQuery(`SELECT summary FROM import_jobs WHERE id = $1`, [jobId]);
    expect(simulation.summary.warnings.BRAND_WILL_BE_REACTIVATED).toBeUndefined();
    await apply(jobId);

    expect(await adminQuery(`SELECT "isActive" FROM brands WHERE id = $1`, [brand.id])).toEqual([{ isActive: false }]);
    expect((await productRow('777')).costPrice).toBe('2.5000');
  });

  it('atualização mostra o diff dos campos novos e a reversão volta os valores anteriores', async () => {
    const productId = await seedProduct({ companyId, barcode: '444', name: 'Queijo', costPrice: 10 });
    const [cat] = await adminQuery(`INSERT INTO categories ("companyId", name) VALUES ($1, 'Frios') RETURNING id`, [companyId]);
    await adminQuery(`UPDATE products SET "categoryId" = $1, unit = 'UN' WHERE id = $2`, [cat.id, productId]);

    const jobId = await simulated([['444', 'Queijo', '10', 'Laticínios', '', '', 'KG', '', '']]);
    const [simRow] = await adminQuery(`SELECT action, diff FROM import_rows WHERE "jobId" = $1`, [jobId]);
    expect(simRow.action).toBe('update');
    expect(simRow.diff).toEqual({ category: { from: 'Frios', to: 'Laticínios' }, unit: { from: 'UN', to: 'KG' } });

    await apply(jobId);
    expect(await productRow('444')).toMatchObject({ unit: 'KG', category: 'Laticínios' });

    await withTenant({ companyId }, (m) => productsImportHandler.rollbackBatch(m, jobId, 100));
    expect(await productRow('444')).toMatchObject({ unit: 'UN', category: 'Frios' });
  });

  it('unidade desconhecida e categoria com 4 níveis viram erro da linha', async () => {
    const jobId = await simulated([
      ['555', 'A', '1', 'A > B > C > D', '', '', '', '', ''],
      ['666', 'B', '1', '', '', '', 'xx', '', ''],
    ]);
    const rows = await adminQuery(`SELECT key, action, errors FROM import_rows WHERE "jobId" = $1 ORDER BY key`, [jobId]);
    expect(rows).toEqual([
      { key: '555', action: 'error', errors: ['Categoria com mais de 3 níveis.'] },
      { key: '666', action: 'error', errors: ['Unidade desconhecida: "xx".'] },
    ]);
  });
});

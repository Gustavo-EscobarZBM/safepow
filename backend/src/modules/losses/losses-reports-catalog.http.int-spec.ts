import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll } from '../../test-utils/test-db';
import { http, seedLoss, seedUser, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';

type Row = { id: string | null; label: string; totalFinancialLoss: string };

describe('Relatórios de perdas por categoria e fornecedor (SP4 4.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Relatórios');
    managerId = await seedUser(companyId);
    token = await tokenFor(managerId, companyId);
  });

  const insertReturningId = async (sql: string, params: unknown[]) => (await adminQuery(sql, params))[0].id as string;

  /** Cada perda do seedLoss tem quantidade 2: valor = 2 × preço. */
  async function scenario() {
    const mercearia = await insertReturningId(`INSERT INTO categories ("companyId", name) VALUES ($1, 'Mercearia') RETURNING id`, [companyId]);
    const bebidas = await insertReturningId(
      `INSERT INTO categories ("companyId", name, "parentId") VALUES ($1, 'Bebidas', $2) RETURNING id`,
      [companyId, mercearia],
    );
    const laticinios = await insertReturningId(`INSERT INTO suppliers ("companyId", name) VALUES ($1, 'Laticínios X') RETURNING id`, [companyId]);

    const refri = await seedProduct({ companyId, barcode: '1', name: 'Refri', unitPrice: 10 });
    const arroz = await seedProduct({ companyId, barcode: '2', name: 'Arroz', unitPrice: 5 });
    const avulso = await seedProduct({ companyId, barcode: '3', name: 'Avulso', unitPrice: 1 });
    await adminQuery(`UPDATE products SET "categoryId" = $1, "supplierId" = $2 WHERE id = $3`, [bebidas, laticinios, refri]);
    await adminQuery(`UPDATE products SET "categoryId" = $1 WHERE id = $2`, [mercearia, arroz]);

    for (const product of [refri, arroz, avulso]) await seedLoss(companyId, product, managerId);
    return { mercearia, bebidas, laticinios, refri };
  }

  const report = async (path: string): Promise<Row[]> => {
    const { status, body } = await http(baseUrl, 'GET', `/api/losses/reports/${path}`, token);
    expect(status).toBe(200);
    return body;
  };
  const totals = (rows: Row[]) => rows.map((r) => [r.label, Number(r.totalFinancialLoss)]);

  it('por categoria: raiz soma as subcategorias; folha separa; sem categoria vira uma linha', async () => {
    const { mercearia, bebidas } = await scenario();

    const root = await report('by-category');
    expect(totals(root)).toEqual([
      ['Mercearia', 30],
      ['Sem categoria', 2],
    ]);
    expect(root[0].id).toBe(mercearia);
    expect(root[1].id).toBeNull();

    const leaf = await report('by-category?level=leaf');
    expect(totals(leaf)).toEqual([
      ['Mercearia > Bebidas', 20],
      ['Mercearia', 10],
      ['Sem categoria', 2],
    ]);
    expect(leaf[0].id).toBe(bebidas);
  });

  it('por fornecedor: sem fornecedor vira uma linha', async () => {
    const { laticinios } = await scenario();
    const rows = await report('by-supplier');
    expect(totals(rows)).toEqual([
      ['Laticínios X', 20],
      ['Sem fornecedor', 12],
    ]);
    expect(rows[0].id).toBe(laticinios);
  });

  it('respeita o período', async () => {
    const { refri } = await scenario();
    await adminQuery(`UPDATE losses SET "occurredAt" = now() - interval '60 days' WHERE "productId" = $1`, [refri]);
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    expect(totals(await report(`by-category?from=${from}&to=${to}`))).toEqual([
      ['Mercearia', 10],
      ['Sem categoria', 2],
    ]);
  });

  it('nível inválido → 400; outra empresa não aparece', async () => {
    expect((await http(baseUrl, 'GET', '/api/losses/reports/by-category?level=x', token)).status).toBe(400);
    const other = await seedCompany('Outra');
    const otherManager = await seedUser(other);
    await seedLoss(other, await seedProduct({ companyId: other, barcode: '9', name: 'Da outra', unitPrice: 100 }), otherManager);
    expect(await report('by-supplier')).toEqual([]);
  });
});

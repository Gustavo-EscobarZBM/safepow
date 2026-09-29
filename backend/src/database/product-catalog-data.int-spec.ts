import { seedLoss, seedUser } from '../test-utils/approvals-test-app';
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll, withTenant } from '../test-utils/test-db';

async function insertCategory(companyId: string, name: string, parentId: string | null = null): Promise<string> {
  const [row] = await adminQuery(
    `INSERT INTO categories ("companyId", name, "parentId") VALUES ($1, $2, $3) RETURNING id`,
    [companyId, name, parentId],
  );
  return row.id;
}

describe('migration 1700000020000 — dados de catálogo do produto (SP4 4.1)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('nome de categoria é único por pai, sem diferenciar maiúsculas, e raízes formam um grupo só', async () => {
    const companyId = await seedCompany('Empresa Categorias');
    const mercearia = await insertCategory(companyId, 'Mercearia');
    const limpeza = await insertCategory(companyId, 'Limpeza');
    await insertCategory(companyId, 'Bebidas');

    await expect(insertCategory(companyId, 'bebidas')).rejects.toThrow(/duplicate key/);
    await insertCategory(companyId, 'Bebidas', mercearia);
    await insertCategory(companyId, 'Bebidas', limpeza);
    await expect(insertCategory(companyId, 'BEBIDAS', mercearia)).rejects.toThrow(/duplicate key/);
  });

  it('recusa o 4º nível e ciclos, inclusive ao mover uma árvore', async () => {
    const companyId = await seedCompany('Empresa Árvore');
    const a = await insertCategory(companyId, 'A');
    const b = await insertCategory(companyId, 'B', a);
    const c = await insertCategory(companyId, 'C', b);

    await expect(insertCategory(companyId, 'D', c)).rejects.toThrow(/categoria:/);
    await expect(adminQuery(`UPDATE categories SET "parentId" = $1 WHERE id = $2`, [c, a])).rejects.toThrow(/categoria:/);
    await expect(adminQuery(`UPDATE categories SET "parentId" = $1 WHERE id = $1`, [a])).rejects.toThrow(/categoria:/);

    const x = await insertCategory(companyId, 'X');
    // A tem 2 níveis abaixo; dentro de X viraria X›A›B›C (4 níveis).
    await expect(adminQuery(`UPDATE categories SET "parentId" = $1 WHERE id = $2`, [x, a])).rejects.toThrow(/categoria:/);
    // B tem 1 nível abaixo; dentro de X fica X›B›C (3 níveis) — permitido.
    await adminQuery(`UPDATE categories SET "parentId" = $1 WHERE id = $2`, [x, b]);
  });

  it('recusa pai de outra empresa', async () => {
    const a = await seedCompany('A');
    const b = await seedCompany('B');
    const parentOfA = await insertCategory(a, 'Mercearia');
    await expect(insertCategory(b, 'Bebidas', parentOfA)).rejects.toThrow(/categoria:/);
  });

  it('RLS isola categorias, marcas e fornecedores', async () => {
    const x = await seedCompany('X');
    const y = await seedCompany('Y');
    for (const companyId of [x, y]) {
      await insertCategory(companyId, 'Cat');
      await adminQuery(`INSERT INTO brands ("companyId", name) VALUES ($1, 'Marca')`, [companyId]);
      await adminQuery(`INSERT INTO suppliers ("companyId", name) VALUES ($1, 'Fornecedor')`, [companyId]);
    }
    for (const table of ['categories', 'brands', 'suppliers']) {
      const seen = await withTenant({ companyId: x }, (m) => m.query(`SELECT "companyId" FROM ${table}`));
      expect(seen).toEqual([{ companyId: x }]);
    }
  });

  it('marca e fornecedor são únicos por empresa sem diferenciar maiúsculas', async () => {
    const companyId = await seedCompany('Empresa Únicos');
    await adminQuery(`INSERT INTO brands ("companyId", name) VALUES ($1, 'Coca-Cola')`, [companyId]);
    await expect(adminQuery(`INSERT INTO brands ("companyId", name) VALUES ($1, 'coca-cola')`, [companyId])).rejects.toThrow(/duplicate key/);
    await adminQuery(`INSERT INTO suppliers ("companyId", name) VALUES ($1, 'Laticínios X')`, [companyId]);
    await expect(adminQuery(`INSERT INTO suppliers ("companyId", name) VALUES ($1, 'LATICÍNIOS X')`, [companyId])).rejects.toThrow(/duplicate key/);
  });

  it('produtos ganham as colunas novas com padrões e o custo guarda 4 casas', async () => {
    const companyId = await seedCompany('Empresa Produtos');
    const productId = await seedProduct({ companyId, barcode: '7890000000001' });
    const [product] = await adminQuery(
      `SELECT unit, "isPerishable", "reviewStatus", "categoryId", "brandId", "supplierId", "shelfLifeDays", "imageUrl", notes
         FROM products WHERE id = $1`,
      [productId],
    );
    expect(product).toEqual({
      unit: 'UN',
      isPerishable: false,
      reviewStatus: 'approved',
      categoryId: null,
      brandId: null,
      supplierId: null,
      shelfLifeDays: null,
      imageUrl: null,
      notes: null,
    });

    await adminQuery(`UPDATE products SET "costPrice" = 3.1234 WHERE id = $1`, [productId]);
    expect((await adminQuery(`SELECT "costPrice" FROM products WHERE id = $1`, [productId]))[0].costPrice).toBe('3.1234');

    const scales = await adminQuery(
      `SELECT table_name, column_name, numeric_scale FROM information_schema.columns
        WHERE (table_name, column_name) IN (('products','costPrice'), ('product_price_history','costPrice'), ('losses','unitCostAtLoss'))
        ORDER BY table_name`,
    );
    expect(scales.map((s: { numeric_scale: number }) => s.numeric_scale)).toEqual([4, 4, 4]);
  });

  it('perda sem custo congelado herda o custo do produto com 4 casas (trigger de fallback)', async () => {
    const companyId = await seedCompany('Empresa Fallback');
    const productId = await seedProduct({ companyId, barcode: '7890000000009', unitPrice: 10, costPrice: 3.1234 });
    const lossId = await seedLoss(companyId, productId, await seedUser(companyId));
    const [loss] = await adminQuery(`SELECT "unitCostAtLoss", "valuationSource" FROM losses WHERE id = $1`, [lossId]);
    expect(loss).toEqual({ unitCostAtLoss: '3.1234', valuationSource: 'fallback_current' });
  });

  it('recusa unidade desconhecida e validade não positiva', async () => {
    const companyId = await seedCompany('Empresa Checks');
    const productId = await seedProduct({ companyId, barcode: '7890000000002' });
    await expect(adminQuery(`UPDATE products SET unit = 'XX' WHERE id = $1`, [productId])).rejects.toThrow(/check constraint/);
    await expect(adminQuery(`UPDATE products SET "shelfLifeDays" = 0 WHERE id = $1`, [productId])).rejects.toThrow(/check constraint/);
    await adminQuery(`UPDATE products SET unit = 'KG', "shelfLifeDays" = 5 WHERE id = $1`, [productId]);
  });

  it('não apaga categoria em uso por produto (RESTRICT)', async () => {
    const companyId = await seedCompany('Empresa Restrict');
    const cat = await insertCategory(companyId, 'Mercearia');
    const productId = await seedProduct({ companyId, barcode: '7890000000003' });
    await adminQuery(`UPDATE products SET "categoryId" = $1 WHERE id = $2`, [cat, productId]);
    await expect(adminQuery(`DELETE FROM categories WHERE id = $1`, [cat])).rejects.toThrow(/foreign key/);
  });

  it('audita inserção de categoria, marca e fornecedor', async () => {
    const companyId = await seedCompany('Empresa Auditoria');
    await insertCategory(companyId, 'Mercearia');
    await adminQuery(`INSERT INTO brands ("companyId", name) VALUES ($1, 'Marca A')`, [companyId]);
    await adminQuery(`INSERT INTO suppliers ("companyId", name) VALUES ($1, 'Fornecedor A')`, [companyId]);
    const rows = await adminQuery(
      `SELECT "entityType", "entityLabel", action FROM audit_log WHERE "companyId" = $1 AND "entityType" IN ('category','brand','supplier') ORDER BY "entityType"`,
      [companyId],
    );
    expect(rows).toEqual([
      { entityType: 'brand', entityLabel: 'Marca A', action: 'create' },
      { entityType: 'category', entityLabel: 'Mercearia', action: 'create' },
      { entityType: 'supplier', entityLabel: 'Fornecedor A', action: 'create' },
    ]);
  });
});

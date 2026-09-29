import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { http, seedUser, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';

describe('Produto com dados de catálogo (SP4 4.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
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
    companyId = await seedCompany('Empresa Produtos 2.0');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  async function category(name: string, parentId: string | null = null, isActive = true): Promise<string> {
    return (
      await adminQuery(`INSERT INTO categories ("companyId", name, "parentId", "isActive") VALUES ($1, $2, $3, $4) RETURNING id`, [
        companyId,
        name,
        parentId,
        isActive,
      ])
    )[0].id;
  }
  const brand = async (name: string, isActive = true) =>
    (await adminQuery(`INSERT INTO brands ("companyId", name, "isActive") VALUES ($1, $2, $3) RETURNING id`, [companyId, name, isActive]))[0].id;
  const supplier = async (name: string) =>
    (await adminQuery(`INSERT INTO suppliers ("companyId", name) VALUES ($1, $2) RETURNING id`, [companyId, name]))[0].id;

  it('cria com todos os campos novos e devolve os rótulos', async () => {
    const mercearia = await category('Mercearia');
    const bebidas = await category('Bebidas', mercearia);
    const { status, body } = await http(baseUrl, 'POST', '/api/products', token, {
      barcode: '7894900011517',
      name: 'Refrigerante Cola 2L',
      unitPrice: 9.99,
      costPrice: 3.1234,
      categoryId: bebidas,
      brandId: await brand('Coca-Cola'),
      supplierId: await supplier('Distribuidora Sul'),
      unit: 'UN',
      isPerishable: true,
      shelfLifeDays: 180,
      imageUrl: 'https://cdn.exemplo/produtos/cola.jpg',
      notes: 'Conferir lote',
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      categoryPath: 'Mercearia > Bebidas',
      brandName: 'Coca-Cola',
      supplierName: 'Distribuidora Sul',
      unit: 'UN',
      isPerishable: true,
      shelfLifeDays: 180,
      imageUrl: 'https://cdn.exemplo/produtos/cola.jpg',
      notes: 'Conferir lote',
    });
    expect(Number(body.costPrice)).toBe(3.1234);
    const [row] = await adminQuery(`SELECT "costPrice" FROM products WHERE id = $1`, [body.id]);
    expect(row.costPrice).toBe('3.1234');
  });

  it('definir categoria ou marca arquivada → 400', async () => {
    const archivedCategory = await category('Antiga', null, false);
    const created = await http(baseUrl, 'POST', '/api/products', token, { barcode: '1001', name: 'Produto A', categoryId: archivedCategory });
    expect(created.status).toBe(400);
    expect(created.body.message).toBe('Categoria inválida ou arquivada.');

    const product = await http(baseUrl, 'POST', '/api/products', token, { barcode: '1002', name: 'Produto B' });
    const edited = await http(baseUrl, 'PATCH', `/api/products/${product.body.id}`, token, { brandId: await brand('Velha', false) });
    expect(edited.status).toBe(400);
    expect(edited.body.message).toBe('Marca inválida ou arquivada.');
  });

  it('produto com categoria arquivada depois continua editável sem trocar a categoria', async () => {
    const cat = await category('Sazonal');
    const product = await http(baseUrl, 'POST', '/api/products', token, { barcode: '1003', name: 'Panetone', categoryId: cat });
    await adminQuery(`UPDATE categories SET "isActive" = false WHERE id = $1`, [cat]);

    const renamed = await http(baseUrl, 'PATCH', `/api/products/${product.body.id}`, token, { name: 'Panetone 500g', categoryId: cat });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Panetone 500g', categoryId: cat, categoryPath: 'Sazonal' });
  });

  it('limpa categoria com null', async () => {
    const cat = await category('Limpeza');
    const product = await http(baseUrl, 'POST', '/api/products', token, { barcode: '1004', name: 'Detergente', categoryId: cat });
    const cleared = await http(baseUrl, 'PATCH', `/api/products/${product.body.id}`, token, { categoryId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ categoryId: null, categoryPath: null });
  });

  it('busca: filtro por categoria raiz traz as subcategorias; marca, fornecedor e unidade filtram', async () => {
    const mercearia = await category('Mercearia');
    const bebidas = await category('Bebidas', mercearia);
    const outra = await category('Outra');
    const marca = await brand('Marca X');
    const forn = await supplier('Fornecedor Y');
    const make = (barcode: string, extra: Record<string, unknown>) =>
      http(baseUrl, 'POST', '/api/products', token, { barcode, name: `Produto ${barcode}`, ...extra });
    await make('2001', { categoryId: mercearia });
    await make('2002', { categoryId: bebidas, brandId: marca, unit: 'KG' });
    await make('2003', { categoryId: outra, supplierId: forn });

    const barcodes = async (query: string) =>
      (await http(baseUrl, 'GET', `/api/products/search?${query}`, token)).body.items.map((p: { barcode: string }) => p.barcode).sort();
    expect(await barcodes(`categoryId=${mercearia}`)).toEqual(['2001', '2002']);
    expect(await barcodes(`categoryId=${bebidas}`)).toEqual(['2002']);
    expect(await barcodes(`brandId=${marca}`)).toEqual(['2002']);
    expect(await barcodes(`supplierId=${forn}`)).toEqual(['2003']);
    expect(await barcodes('unit=KG')).toEqual(['2002']);

    const page = await http(baseUrl, 'GET', `/api/products/search?categoryId=${bebidas}`, token);
    expect(page.body.items[0]).toMatchObject({ categoryPath: 'Mercearia > Bebidas', brandName: 'Marca X' });
  });

  it('valida unidade, validade e tamanho das observações', async () => {
    const post = (extra: Record<string, unknown>) => http(baseUrl, 'POST', '/api/products', token, { barcode: '3001', name: 'Produto', ...extra });
    expect((await post({ unit: 'XX' })).status).toBe(400);
    expect((await post({ shelfLifeDays: 0 })).status).toBe(400);
    expect((await post({ notes: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post({ costPrice: 1.23456 })).status).toBe(400);
  });

  it('sync do app traz unidade, foto e perecível', async () => {
    await http(baseUrl, 'POST', '/api/products', token, {
      barcode: '4001',
      name: 'Patinho',
      unit: 'KG',
      isPerishable: true,
      imageUrl: 'https://cdn.exemplo/p.jpg',
    });
    const { body } = await http(baseUrl, 'GET', '/api/products?limit=10', token);
    expect(body[0]).toMatchObject({ unit: 'KG', isPerishable: true, imageUrl: 'https://cdn.exemplo/p.jpg' });
  });
});

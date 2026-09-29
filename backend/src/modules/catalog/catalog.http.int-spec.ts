import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { http, seedUser, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';
import { UserRole } from '../users/user.entity';
import { BrandsController } from './brands.controller';
import { CATALOG_PROVIDERS } from './catalog.module';
import { CategoriesController } from './categories.controller';
import { SuppliersController } from './suppliers.controller';

describe('Categorias, marcas e fornecedores (SP4 4.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp({
      controllers: [CategoriesController, BrandsController, SuppliersController],
      providers: CATALOG_PROVIDERS,
    }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Catálogo');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  const post = (path: string, body: unknown) => http(baseUrl, 'POST', `/api/${path}`, token, body);

  it.each(['brands', 'suppliers'])('%s: cria, lista, edita, arquiva e reativa', async (resource) => {
    const created = await post(resource, { name: 'Primeiro' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Primeiro', isActive: true });

    const edited = await http(baseUrl, 'PATCH', `/api/${resource}/${created.body.id}`, token, { name: 'Renomeado' });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe('Renomeado');

    expect((await post(`${resource}/${created.body.id}/archive`, undefined)).status).toBe(200);
    expect((await http(baseUrl, 'GET', `/api/${resource}`, token)).body).toEqual([]);
    const all = await http(baseUrl, 'GET', `/api/${resource}?includeArchived=true`, token);
    expect(all.body).toEqual([expect.objectContaining({ name: 'Renomeado', isActive: false })]);

    expect((await post(`${resource}/${created.body.id}/restore`, undefined)).status).toBe(200);
    expect((await http(baseUrl, 'GET', `/api/${resource}`, token)).body).toHaveLength(1);
  });

  it('fornecedor guarda os dados de contato', async () => {
    const { status, body } = await post('suppliers', {
      name: 'Laticínios X',
      taxId: '12.345.678/0001-90',
      contactName: 'Maria',
      phone: '(11) 99999-0000',
      email: 'maria@laticinios.com.br',
      notes: 'Entrega às terças',
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({ taxId: '12.345.678/0001-90', contactName: 'Maria', email: 'maria@laticinios.com.br' });
  });

  it('nome repetido com outra caixa → 409', async () => {
    await post('brands', { name: 'Coca-Cola' });
    const dup = await post('brands', { name: 'coca-cola' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('Já existe uma marca com este nome.');

    const first = await post('brands', { name: 'Nestlé' });
    const renamed = await http(baseUrl, 'PATCH', `/api/brands/${first.body.id}`, token, { name: 'COCA-COLA' });
    expect(renamed.status).toBe(409);
  });

  it('categorias: caminho, duplicado por pai e limite de 3 níveis', async () => {
    const mercearia = (await post('categories', { name: 'Mercearia' })).body;
    const bebidas = (await post('categories', { name: 'Bebidas', parentId: mercearia.id })).body;
    const refri = (await post('categories', { name: 'Refrigerantes', parentId: bebidas.id })).body;
    expect(refri.path).toBe('Mercearia > Bebidas > Refrigerantes');

    const level4 = await post('categories', { name: 'Cola', parentId: refri.id });
    expect(level4.status).toBe(400);
    expect(level4.body.message).toMatch(/3 níveis/);

    const cycle = await http(baseUrl, 'PATCH', `/api/categories/${mercearia.id}`, token, { parentId: bebidas.id });
    expect(cycle.status).toBe(400);

    expect((await post('categories', { name: 'bebidas', parentId: mercearia.id })).status).toBe(409);
    expect((await post('categories', { name: 'Bebidas' })).status).toBe(201);

    const list = await http(baseUrl, 'GET', '/api/categories', token);
    expect(list.body.map((c: { path: string }) => c.path)).toEqual([
      'Bebidas',
      'Mercearia',
      'Mercearia > Bebidas',
      'Mercearia > Bebidas > Refrigerantes',
    ]);
  });

  it('categoria: pai inexistente → 400', async () => {
    const { status } = await post('categories', { name: 'Solta', parentId: '00000000-0000-4000-8000-000000000000' });
    expect(status).toBe(400);
  });

  it('arquivar categoria com filha ativa → 409; reativar filha com pai arquivado → 409', async () => {
    const pai = (await post('categories', { name: 'Pai' })).body;
    const filha = (await post('categories', { name: 'Filha', parentId: pai.id })).body;

    const blocked = await post(`categories/${pai.id}/archive`, undefined);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('Arquive primeiro as subcategorias.');

    expect((await post(`categories/${filha.id}/archive`, undefined)).status).toBe(200);
    expect((await post(`categories/${pai.id}/archive`, undefined)).status).toBe(200);
    const restore = await post(`categories/${filha.id}/restore`, undefined);
    expect(restore.status).toBe(409);
    expect(restore.body.message).toBe('Reative primeiro a categoria pai.');
  });

  it('arquivar não mexe nos produtos ligados', async () => {
    const marca = (await post('brands', { name: 'Marca' })).body;
    const [product] = await adminQuery(
      `INSERT INTO products ("companyId", barcode, name, "brandId") VALUES ($1, '789', 'Produto', $2) RETURNING id`,
      [companyId, marca.id],
    );
    await post(`brands/${marca.id}/archive`, undefined);
    const [row] = await adminQuery(`SELECT "brandId" FROM products WHERE id = $1`, [product.id]);
    expect(row.brandId).toBe(marca.id);
  });

  it('funcionário lê mas não escreve', async () => {
    const employee = await tokenFor(await seedUser(companyId, 'employee'), companyId, UserRole.EMPLOYEE);
    expect((await http(baseUrl, 'GET', '/api/categories', employee)).status).toBe(200);
    expect((await http(baseUrl, 'POST', '/api/categories', employee, { name: 'X' })).status).toBe(403);
  });

  it('outra empresa não aparece', async () => {
    const other = await seedCompany('Outra');
    await adminQuery(`INSERT INTO brands ("companyId", name) VALUES ($1, 'Da outra')`, [other]);
    expect((await http(baseUrl, 'GET', '/api/brands?includeArchived=true', token)).body).toEqual([]);
  });

  it('exporta em CSV com os cabeçalhos de cada cadastro', async () => {
    await post('categories', { name: 'Mercearia' });
    await post('suppliers', { name: 'Fornecedor A' });
    const csvHeader = async (resource: string) => {
      const response = await fetch(`${baseUrl}/api/${resource}/export?format=csv`, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      return (await response.text()).replace(/^﻿/, '').split(/\r?\n/)[0];
    };
    expect(await csvHeader('categories')).toBe('Caminho;Situação');
    expect(await csvHeader('brands')).toBe('Nome;Situação');
    expect(await csvHeader('suppliers')).toBe('Nome;CNPJ/CPF;Contato;Telefone;E-mail;Observações;Situação');
  });
});

import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll, withTenant } from '../../test-utils/test-db';
import { SearchProductsDto } from './dto/search-products.dto';
import { ProductsService } from './products.service';

function search(companyId: string, query: SearchProductsDto) {
  return withTenant({ companyId }, () => new ProductsService().search(query));
}

function names(result: { items: { name: string }[] }): string[] {
  return result.items.map((item) => item.name);
}

describe('ProductsService.search (Postgres real)', () => {
  let companyId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Busca');
  });
  afterAll(() => closeTestConnections());

  it('nome por conteúdo, sem diferenciar maiúsculas', async () => {
    await seedProduct({ companyId, barcode: '7891', name: 'Arroz 5kg' });
    await seedProduct({ companyId, barcode: '7892', name: 'Feijão Arroz-doce' });
    await seedProduct({ companyId, barcode: '5550', name: 'Feijão' });

    expect(names(await search(companyId, { q: 'ARROZ' })).sort()).toEqual(['Arroz 5kg', 'Feijão Arroz-doce']);
  });

  it('código de barras por PREFIXO (não por conteúdo)', async () => {
    await seedProduct({ companyId, barcode: '7891000', name: 'Produto A' });
    await seedProduct({ companyId, barcode: '1117891', name: 'Produto B' });

    expect(names(await search(companyId, { q: '789' }))).toEqual(['Produto A']);
  });

  it('SKU por prefixo, sem diferenciar maiúsculas', async () => {
    const id = await seedProduct({ companyId, barcode: '1', name: 'Com SKU' });
    await adminQuery(`UPDATE products SET sku = 'ABC-123' WHERE id = $1`, [id]);
    await seedProduct({ companyId, barcode: '2', name: 'Sem SKU' });

    expect(names(await search(companyId, { q: 'abc' }))).toEqual(['Com SKU']);
  });

  it('"%" é procurado literalmente — não vira "tudo"', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Suco 100% uva' });
    await seedProduct({ companyId, barcode: '2', name: 'Suco de maçã' });

    expect(names(await search(companyId, { q: '100%' }))).toEqual(['Suco 100% uva']);
    expect(names(await search(companyId, { q: '%' }))).toEqual(['Suco 100% uva']);
  });

  it('"_" é procurado literalmente — não vira "qualquer caractere"', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'caixa_a' });
    await seedProduct({ companyId, barcode: '2', name: 'caixa-a' });

    expect(names(await search(companyId, { q: 'caixa_a' }))).toEqual(['caixa_a']);
  });

  it('barra invertida é procurada literalmente', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'pasta\\x' });
    await seedProduct({ companyId, barcode: '2', name: 'pastax' });

    expect(names(await search(companyId, { q: '\\x' }))).toEqual(['pasta\\x']);
  });

  it('status: padrão só ativos; "archived" só arquivados; "all" os dois', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Ativo' });
    const archivedId = await seedProduct({ companyId, barcode: '2', name: 'Arquivado' });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archivedId]);

    expect(names(await search(companyId, {}))).toEqual(['Ativo']);
    expect(names(await search(companyId, { status: 'archived' }))).toEqual(['Arquivado']);
    expect(names(await search(companyId, { status: 'all' }))).toEqual(['Arquivado', 'Ativo']);
  });

  it('paginação: total de TODOS os resultados e fatia da página, ordenada por nome', async () => {
    for (let i = 1; i <= 25; i += 1) {
      await seedProduct({ companyId, barcode: `${1000 + i}`, name: `Produto ${String(i).padStart(2, '0')}` });
    }

    const page3 = await search(companyId, { page: 3, pageSize: 10 });

    expect(page3.total).toBe(25);
    expect(page3.page).toBe(3);
    expect(page3.pageSize).toBe(10);
    expect(names(page3)).toEqual(['Produto 21', 'Produto 22', 'Produto 23', 'Produto 24', 'Produto 25']);
  });

  it('sem page/pageSize: página 1 com 20 itens', async () => {
    for (let i = 1; i <= 21; i += 1) {
      await seedProduct({ companyId, barcode: `${2000 + i}`, name: `Item ${String(i).padStart(2, '0')}` });
    }

    const result = await search(companyId, {});

    expect(result).toMatchObject({ total: 21, page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(20);
  });

  it('sort=updatedAt: o alterado por último vem primeiro', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Antigo' });
    const recentId = await seedProduct({ companyId, barcode: '2', name: 'Recente' });
    await adminQuery(`UPDATE products SET "updatedAt" = now() + interval '1 minute' WHERE id = $1`, [recentId]);

    expect(names(await search(companyId, { sort: 'updatedAt' }))).toEqual(['Recente', 'Antigo']);
  });

  it('RLS: produtos de outra empresa não aparecem nem contam no total', async () => {
    const other = await seedCompany('Outra Empresa Busca');
    await seedProduct({ companyId, barcode: '1', name: 'Meu' });
    await seedProduct({ companyId: other, barcode: '2', name: 'Dela' });

    const result = await search(companyId, { status: 'all' });

    expect(result.total).toBe(1);
    expect(names(result)).toEqual(['Meu']);
  });
});

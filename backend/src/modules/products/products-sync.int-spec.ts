import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll, withTenant } from '../../test-utils/test-db';
import { SyncProductsQueryDto } from './dto/sync-products.dto';
import { ProductsService } from './products.service';

function sync(companyId: string, query: SyncProductsQueryDto) {
  return withTenant({ companyId }, () => new ProductsService().findForSync(query));
}

async function setUpdatedAt(companyId: string, value: string): Promise<void> {
  await adminQuery(`UPDATE products SET "updatedAt" = $2 WHERE "companyId" = $1`, [companyId, value]);
}

async function archive(productId: string): Promise<void> {
  await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);
}

describe('ProductsService.findForSync (Postgres real)', () => {
  let companyId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Sync');
  });
  afterAll(() => closeTestConnections());

  it('legado sem since: só ativos, por nome — igual ao GET /products de antes', async () => {
    await seedProduct({ companyId, barcode: '2', name: 'Banana' });
    await seedProduct({ companyId, barcode: '1', name: 'Abacate' });
    await archive(await seedProduct({ companyId, barcode: '3', name: 'Arquivado' }));

    const page = await sync(companyId, {});

    expect(page.items.map((p) => p.name)).toEqual(['Abacate', 'Banana']);
    expect(page.nextAfter).toBeNull();
  });

  it('legado com since: só ativos alterados depois, por updatedAt', async () => {
    const old = await seedProduct({ companyId, barcode: '1', name: 'Antigo' });
    const recent = await seedProduct({ companyId, barcode: '2', name: 'Recente' });
    await adminQuery(`UPDATE products SET "updatedAt" = '2026-01-01T00:00:00Z' WHERE id = $1`, [old]);
    await adminQuery(`UPDATE products SET "updatedAt" = '2026-09-01T00:00:00Z' WHERE id = $1`, [recent]);

    const page = await sync(companyId, { since: '2026-06-01T00:00:00.123456Z' });

    expect(page.items.map((p) => p.name)).toEqual(['Recente']);
  });

  it('includeArchived=true traz os arquivados (tombstones) com isActive=false', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Ativo' });
    await archive(await seedProduct({ companyId, barcode: '2', name: 'Arquivado' }));

    const page = await sync(companyId, { includeArchived: true });

    expect(page.items.map((p) => [p.name, p.isActive]).sort()).toEqual([
      ['Arquivado', false],
      ['Ativo', true],
    ]);
  });

  it('25 produtos com o MESMO updatedAt e limit 10: três páginas, sem repetir nem perder, sem loop', async () => {
    for (let i = 1; i <= 25; i += 1) {
      await seedProduct({ companyId, barcode: `${1000 + i}`, name: `P${i}` });
    }
    await setUpdatedAt(companyId, '2026-09-01T10:00:00.123456Z');

    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await sync(companyId, { includeArchived: true, limit: 10, after });
      seen.push(...page.items.map((p) => p.id));
      after = page.nextAfter ?? undefined;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(4); // trava de segurança contra loop
    } while (after);

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(pages).toBe(3);
  });

  it('total múltiplo de limit: a página cheia manda nextAfter; a seguinte vem vazia e sem nextAfter', async () => {
    for (let i = 1; i <= 4; i += 1) {
      await seedProduct({ companyId, barcode: `${2000 + i}`, name: `Q${i}` });
    }

    const first = await sync(companyId, { includeArchived: true, limit: 2 });
    const second = await sync(companyId, { includeArchived: true, limit: 2, after: first.nextAfter! });
    const third = await sync(companyId, { includeArchived: true, limit: 2, after: second.nextAfter! });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(second.nextAfter).not.toBeNull();
    expect(third.items).toEqual([]);
    expect(third.nextAfter).toBeNull();
  });

  it('o cursor tem microssegundos do banco (não é truncado em milissegundos)', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Único' });
    await setUpdatedAt(companyId, '2026-09-01T10:00:00.123456Z');

    const page = await sync(companyId, { limit: 1, includeArchived: true });

    expect(page.nextAfter).toMatch(/^2026-09-01T10:00:00\.123456Z\|/);
  });

  it('syncCursor é o now() do banco no início da transação, com microssegundos', async () => {
    const before = (await adminQuery(`SELECT now() AS n`))[0].n as Date;

    const page = await sync(companyId, {});

    expect(page.syncCursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(new Date(page.syncCursor).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
  });

  it('RLS: nunca devolve produtos de outra empresa, nem como tombstone', async () => {
    const other = await seedCompany('Outra Sync');
    await seedProduct({ companyId, barcode: '1', name: 'Meu' });
    await archive(await seedProduct({ companyId: other, barcode: '2', name: 'Dela' }));

    const page = await sync(companyId, { includeArchived: true });

    expect(page.items.map((p) => p.name)).toEqual(['Meu']);
  });
});

import { NotFoundException } from '@nestjs/common';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { ProductsService } from './products.service';

async function archive(productId: string): Promise<void> {
  await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);
}

describe('ciclo de vida do produto — restore e findByBarcode (Postgres real)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('restore reativa e é idempotente (duas chamadas seguidas dão o mesmo resultado)', async () => {
    const companyId = await seedCompany('Empresa Ciclo');
    const productId = await seedProduct({ companyId, barcode: '1001' });
    await archive(productId);

    const first = await withTenant({ companyId }, () => new ProductsService().restore(productId));
    const second = await withTenant({ companyId }, () => new ProductsService().restore(productId));

    expect(first.isActive).toBe(true);
    expect(second.isActive).toBe(true);
    const [row] = await adminQuery(`SELECT "isActive" FROM products WHERE id = $1`, [productId]);
    expect(row.isActive).toBe(true);
  });

  it('restore de produto de OUTRA empresa ⇒ 404 (a RLS esconde) e nada muda', async () => {
    const a = await seedCompany('Empresa A Ciclo');
    const b = await seedCompany('Empresa B Ciclo');
    const productOfB = await seedProduct({ companyId: b, barcode: '1002' });
    await archive(productOfB);

    await expect(withTenant({ companyId: a }, () => new ProductsService().restore(productOfB))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const [row] = await adminQuery(`SELECT "isActive" FROM products WHERE id = $1`, [productOfB]);
    expect(row.isActive).toBe(false);
  });

  it('findByBarcode não devolve produto arquivado (F11)', async () => {
    const companyId = await seedCompany('Empresa Barcode');
    const productId = await seedProduct({ companyId, barcode: '1003' });
    await archive(productId);

    await expect(
      withTenant({ companyId }, () => new ProductsService().findByBarcode('1003')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByBarcode continua devolvendo produto ativo', async () => {
    const companyId = await seedCompany('Empresa Barcode Ativo');
    const productId = await seedProduct({ companyId, barcode: '1004' });

    const found = await withTenant({ companyId }, () => new ProductsService().findByBarcode('1004'));

    expect(found.id).toBe(productId);
  });
});

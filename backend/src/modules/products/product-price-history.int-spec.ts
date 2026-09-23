import { NotFoundException } from '@nestjs/common';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { UserRole } from '../users/user.entity';
import { ProductsService } from './products.service';

describe('ProductsService.findPriceHistory', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('lista o histórico do mais recente para o mais antigo, com o nome de quem alterou', async () => {
    const companyId = await seedCompany('Empresa Histórico');
    const managerId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Gerente Histórico', 'gerente-historico@teste.local', 'x', 'manager', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const productId = await seedProduct({ companyId, barcode: '9001', unitPrice: 10, costPrice: 6 });
    const ctx = { companyId, userId: managerId, role: UserRole.MANAGER };
    await withTenant(ctx, () => new ProductsService().update(productId, { unitPrice: 12 }));

    const history = await withTenant(ctx, () => new ProductsService().findPriceHistory(productId));

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      unitPrice: 12,
      costPrice: 6,
      source: 'manual',
      changedByUserId: managerId,
      changedByName: 'Gerente Histórico',
    });
    expect(history[1]).toMatchObject({ unitPrice: 10, changedByName: null });
    expect(history[0].validFrom.getTime()).toBeGreaterThanOrEqual(history[1].validFrom.getTime());
  });

  it('devolve no máximo as 100 linhas mais recentes', async () => {
    const companyId = await seedCompany('Empresa Muitas Mudanças');
    const productId = await seedProduct({ companyId, barcode: '9002', unitPrice: 1 });
    await adminQuery(
      `INSERT INTO product_price_history ("companyId", "productId", "unitPrice", "costPrice", "validFrom", source)
       SELECT $1, $2, n, 0, now() + (n || ' seconds')::interval, 'bulk' FROM generate_series(1, 105) AS n`,
      [companyId, productId],
    );

    const history = await withTenant({ companyId }, () => new ProductsService().findPriceHistory(productId));

    expect(history).toHaveLength(100);
    expect(history[0].unitPrice).toBe(105);
  });

  it('produto de outra empresa responde 404 (a RLS não deixa enxergar)', async () => {
    const a = await seedCompany('Empresa A Histórico');
    const b = await seedCompany('Empresa B Histórico');
    const productOfB = await seedProduct({ companyId: b, barcode: '9003' });

    await expect(
      withTenant({ companyId: a }, () => new ProductsService().findPriceHistory(productOfB)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

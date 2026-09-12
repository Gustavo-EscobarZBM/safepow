import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from '../users/user.entity';
import { ProductsService } from './products.service';

const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
}

describe('ProductsService — costPrice', () => {
  it('grava costPrice ao criar um produto', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'prod-1', ...data })),
    };
    const service = new ProductsService();

    const result = await runWithTenantContext(manager, () =>
      service.create({ barcode: '123', name: 'Arroz 5kg', unitPrice: 24.9, costPrice: 18.5 }),
    );

    expect(result).toMatchObject({ costPrice: 18.5 });
  });

  it('atualiza costPrice quando informado', async () => {
    const existing = { id: 'prod-1', barcode: '123', name: 'Arroz 5kg', unitPrice: 24.9, costPrice: 18.5 };
    const manager = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };
    const service = new ProductsService();

    const result = await runWithTenantContext(manager, () => service.update('prod-1', { costPrice: 20 }));

    expect(result).toMatchObject({ costPrice: 20 });
  });
});

import { BadRequestException } from '@nestjs/common';
import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from '../users/user.entity';
import { CompanyRevenueService } from './company-revenue.service';

const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
}

describe('CompanyRevenueService', () => {
  it('cria o faturamento do mês quando ainda não existe', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'rev-1', ...data })),
    };
    const service = new CompanyRevenueService();

    const result = await runWithTenantContext(manager, () =>
      service.upsert(2026, 4, { revenueAmount: 50000 }),
    );

    expect(manager.create).toHaveBeenCalledWith(expect.anything(), {
      companyId: COMPANY_ID,
      year: 2026,
      month: 4,
      revenueAmount: 50000,
    });
    expect(result).toMatchObject({ revenueAmount: 50000 });
  });

  it('substitui o valor do mês quando já existe (upsert)', async () => {
    const existing = { id: 'rev-1', companyId: COMPANY_ID, year: 2026, month: 4, revenueAmount: 50000 };
    const manager = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };
    const service = new CompanyRevenueService();

    const result = await runWithTenantContext(manager, () =>
      service.upsert(2026, 4, { revenueAmount: 62000 }),
    );

    expect(result).toMatchObject({ revenueAmount: 62000 });
  });

  it('rejeita mês fora do intervalo 1-12', async () => {
    const manager = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    const service = new CompanyRevenueService();

    await expect(
      runWithTenantContext(manager, () => service.upsert(2026, 13, { revenueAmount: 1000 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('find retorna null quando não há faturamento cadastrado no mês', async () => {
    const manager = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new CompanyRevenueService();

    const result = await runWithTenantContext(manager, () => service.find(2026, 4));

    expect(result).toBeNull();
  });
});

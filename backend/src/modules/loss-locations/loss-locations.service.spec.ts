import { ConflictException, NotFoundException } from '@nestjs/common';
import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from '../users/user.entity';
import { LossLocationsService } from './loss-locations.service';

const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
}

describe('LossLocationsService', () => {
  it('cria um novo local quando o nome ainda não existe na empresa', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'location-1', ...data })),
    };
    const service = new LossLocationsService();

    const result = await runWithTenantContext(manager, () => service.create({ name: 'Estacionamento' }));

    expect(result).toEqual({ id: 'location-1', companyId: COMPANY_ID, name: 'Estacionamento' });
  });

  it('rejeita nome duplicado dentro da mesma empresa', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: 'location-existente', name: 'Caixa/Frente de loja' }),
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = new LossLocationsService();

    await expect(
      runWithTenantContext(manager, () => service.create({ name: 'Caixa/Frente de loja' })),
    ).rejects.toThrow(ConflictException);
  });

  it('lança NotFoundException ao excluir um id inexistente', async () => {
    const manager = { delete: jest.fn().mockResolvedValue({ affected: 0 }) };
    const service = new LossLocationsService();

    await expect(runWithTenantContext(manager, () => service.remove('id-que-nao-existe'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('traduz violação de FK (local em uso) num erro amigável em vez de deixar vazar o erro do Postgres', async () => {
    const fkError = Object.assign(new Error('update or delete violates foreign key constraint'), {
      code: '23503',
    });
    const manager = { delete: jest.fn().mockRejectedValue(fkError) };
    const service = new LossLocationsService();

    await expect(runWithTenantContext(manager, () => service.remove('location-em-uso'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('remove normalmente quando não há perdas usando o local', async () => {
    const manager = { delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    const service = new LossLocationsService();

    await expect(runWithTenantContext(manager, () => service.remove('location-1'))).resolves.toBeUndefined();
  });
});

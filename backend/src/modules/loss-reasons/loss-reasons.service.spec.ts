import { ConflictException, NotFoundException } from '@nestjs/common';
import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from '../users/user.entity';
import { LossReasonsService } from './loss-reasons.service';

const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
}

describe('LossReasonsService', () => {
  it('cria um novo motivo quando o nome ainda não existe na empresa', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'reason-1', ...data })),
    };
    const service = new LossReasonsService();

    const result = await runWithTenantContext(manager, () => service.create({ name: 'Umidade' }));

    expect(result).toEqual({ id: 'reason-1', companyId: COMPANY_ID, name: 'Umidade' });
  });

  it('rejeita nome duplicado dentro da mesma empresa', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: 'reason-existente', name: 'Furto' }),
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = new LossReasonsService();

    await expect(runWithTenantContext(manager, () => service.create({ name: 'Furto' }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('lança NotFoundException ao excluir um id inexistente', async () => {
    const manager = { delete: jest.fn().mockResolvedValue({ affected: 0 }) };
    const service = new LossReasonsService();

    await expect(runWithTenantContext(manager, () => service.remove('id-que-nao-existe'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('traduz violação de FK (motivo em uso) num erro amigável em vez de deixar vazar o erro do Postgres', async () => {
    const fkError = Object.assign(new Error('update or delete violates foreign key constraint'), {
      code: '23503',
    });
    const manager = { delete: jest.fn().mockRejectedValue(fkError) };
    const service = new LossReasonsService();

    await expect(runWithTenantContext(manager, () => service.remove('reason-em-uso'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('remove normalmente quando não há perdas usando o motivo', async () => {
    const manager = { delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    const service = new LossReasonsService();

    await expect(runWithTenantContext(manager, () => service.remove('reason-1'))).resolves.toBeUndefined();
  });
});

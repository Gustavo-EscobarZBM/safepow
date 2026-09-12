import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from './user.entity';
import { UsersService } from './users.service';

const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
}

describe('UsersService.getMe', () => {
  it('inclui o nome da empresa do usuário logado (Perfil no app mobile precisa disso)', async () => {
    const user = {
      id: 'user-1',
      companyId: COMPANY_ID,
      name: 'Maria Gerente',
      email: 'maria@empresa.com',
      role: UserRole.MANAGER,
      isActive: true,
      passwordHash: 'hash-nao-deve-vazar',
    };
    const company = { id: COMPANY_ID, name: 'Empresa Demo' };
    const manager = {
      findOne: jest.fn().mockImplementation((entity: any, _opts: any) => {
        return Promise.resolve(entity.name === 'User' ? user : company);
      }),
    };
    const service = new UsersService();

    const result = await runWithTenantContext(manager, () => service.getMe());

    expect(result).toMatchObject({ name: 'Maria Gerente', companyName: 'Empresa Demo' });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('retorna companyName nulo para master_admin (sem empresa associada)', async () => {
    const user = {
      id: 'master-1',
      companyId: null,
      name: 'Admin Master',
      email: 'master@seusistema.com.br',
      role: UserRole.MASTER_ADMIN,
      isActive: true,
      passwordHash: 'hash',
    };
    const manager = {
      findOne: jest.fn().mockResolvedValue(user),
    };
    const service = new UsersService();

    const result = await runWithTenantContext(manager, () => service.getMe());

    expect(result).toMatchObject({ name: 'Admin Master', companyName: null });
    // Não deve nem tentar buscar a empresa quando companyId é nulo.
    expect(manager.findOne).toHaveBeenCalledTimes(1);
  });
});

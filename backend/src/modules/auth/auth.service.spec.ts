import { AuthService } from './auth.service';
import { CompanyStatus } from '../companies/company.entity';
import { UserRole } from '../users/user.entity';

// bcrypt expõe compare() como binding nativo (propriedade não-configurável),
// então jest.spyOn(bcrypt, 'compare') falha com "Cannot redefine property".
// jest.mock no nível do módulo substitui o pacote inteiro antes do import,
// evitando essa limitação.
jest.mock('bcrypt', () => ({ compare: jest.fn().mockResolvedValue(true) }));

function makeService(overrides: { lookupRow?: any; company?: any } = {}) {
  const dataSource = {
    query: jest.fn().mockResolvedValue([
      overrides.lookupRow ?? {
        id: 'user-1',
        companyId: 'company-1',
        passwordHash: 'hash',
        role: UserRole.MANAGER,
        isActive: true,
        name: 'Gerente Teste',
      },
    ]),
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('fake-token') };
  const companiesRepository = {
    findOne: jest.fn().mockResolvedValue(
      overrides.company ?? {
        id: 'company-1',
        status: CompanyStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastManualUnlockAt: null,
        lossVerificationEnabled: false,
        lossVerifierId: null,
      },
    ),
    save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
  };
  const service = new AuthService(dataSource as any, jwtService as any, companiesRepository as any);
  return { service };
}

describe('AuthService.login — payload de conferência de descarte', () => {
  it('retorna lossVerificationEnabled=true e isLossVerifier=true quando o usuário é o conferente', async () => {
    const { service } = makeService({
      company: {
        id: 'company-1',
        status: CompanyStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastManualUnlockAt: null,
        lossVerificationEnabled: true,
        lossVerifierId: 'user-1',
      },
    });

    const result = await service.login('gerente@empresa.com', 'senha123');

    expect(result.lossVerificationEnabled).toBe(true);
    expect(result.isLossVerifier).toBe(true);
  });

  it('retorna isLossVerifier=false quando o usuário logado não é o conferente designado', async () => {
    const { service } = makeService({
      company: {
        id: 'company-1',
        status: CompanyStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastManualUnlockAt: null,
        lossVerificationEnabled: true,
        lossVerifierId: 'outro-usuario',
      },
    });

    const result = await service.login('gerente@empresa.com', 'senha123');

    expect(result.isLossVerifier).toBe(false);
  });

  it('MASTER_ADMIN (sem empresa) recebe lossVerificationEnabled=false e isLossVerifier=false', async () => {
    const { service } = makeService({
      lookupRow: {
        id: 'master-1',
        companyId: null,
        passwordHash: 'hash',
        role: UserRole.MASTER_ADMIN,
        isActive: true,
        name: 'Master',
      },
    });

    const result = await service.login('master@sistema.com', 'senha123');

    expect(result.lossVerificationEnabled).toBe(false);
    expect(result.isLossVerifier).toBe(false);
  });
});

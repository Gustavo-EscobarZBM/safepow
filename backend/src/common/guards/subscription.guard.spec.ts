import { ExecutionContext, HttpException } from '@nestjs/common';
import { SubscriptionGuard } from '../guards/subscription.guard';
import { CompanyStatus } from '../../modules/companies/company.entity';
import { UserRole } from '../../modules/users/user.entity';

function makeContext(authUser?: { role: UserRole; companyId: string | null }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ authUser }) }),
  } as unknown as ExecutionContext;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function makeGuard(companyStatus: CompanyStatus | null, currentPeriodEnd: Date | null = daysAgo(-30)) {
  const companiesRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(companyStatus ? { status: companyStatus, currentPeriodEnd, lastManualUnlockAt: null } : null),
    save: jest.fn().mockImplementation((company) => Promise.resolve(company)),
  };
  return { guard: new SubscriptionGuard(companiesRepository as any), companiesRepository };
}

describe('SubscriptionGuard', () => {
  it('nunca bloqueia o MASTER_ADMIN (ele não pertence a nenhuma empresa)', async () => {
    const { guard } = makeGuard(CompanyStatus.BLOCKED);
    const context = makeContext({ role: UserRole.MASTER_ADMIN, companyId: null });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([CompanyStatus.TRIAL, CompanyStatus.ACTIVE, CompanyStatus.PAST_DUE])(
    'permite acesso quando a empresa está em status "%s" e em dia com o vencimento',
    async (status) => {
      const { guard } = makeGuard(status);
      const context = makeContext({ role: UserRole.MANAGER, companyId: 'company-1' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    },
  );

  it.each([
    [CompanyStatus.BLOCKED, daysAgo(10)],
    [CompanyStatus.CANCELED, daysAgo(-30)],
  ] as const)('bloqueia com 402 SUBSCRIPTION_INACTIVE quando a empresa está "%s"', async (status, currentPeriodEnd) => {
    const { guard } = makeGuard(status, currentPeriodEnd);
    const context = makeContext({ role: UserRole.EMPLOYEE, companyId: 'company-1' });
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });

  it('bloqueia quando a empresa referenciada não existe mais', async () => {
    const { guard } = makeGuard(null);
    const context = makeContext({ role: UserRole.MANAGER, companyId: 'company-inexistente' });
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });

  it('auto-cura: empresa gravada como Ativa mas vencida há mais de 3 dias é recalculada, persistida e bloqueada como Bloqueada', async () => {
    const { guard, companiesRepository } = makeGuard(CompanyStatus.ACTIVE, daysAgo(10));
    const context = makeContext({ role: UserRole.MANAGER, companyId: 'company-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(companiesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CompanyStatus.BLOCKED }),
    );
  });

  it('auto-cura: empresa gravada como Bloqueada mas com vencimento renovado (futuro) é recalculada, persistida e liberada', async () => {
    const { guard, companiesRepository } = makeGuard(CompanyStatus.BLOCKED, daysAgo(-30));
    const context = makeContext({ role: UserRole.MANAGER, companyId: 'company-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(companiesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CompanyStatus.ACTIVE }),
    );
  });
});

import { NotFoundException } from '@nestjs/common';
import { tenantStorage } from '../../../common/tenant/tenant-storage';
import { UserRole } from '../../users/user.entity';
import { CompaniesService } from '../companies.service';
import { CompanyStatus } from '../company.entity';

function makeService(companyFromDb: any) {
  const companiesRepository = {
    findOne: jest.fn().mockResolvedValue(companyFromDb),
    save: jest.fn().mockImplementation((company) => Promise.resolve(company)),
  };
  const usersRepository = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn() };
  return { service: new CompaniesService(companiesRepository as any, usersRepository as any, dataSource as any), companiesRepository, dataSource };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('CompaniesService.updateStatus', () => {
  it('atualiza o status e salva a empresa (efeito imediato do bloqueio remoto)', async () => {
    const company = { id: 'company-1', status: CompanyStatus.ACTIVE };
    const { service } = makeService(company);

    const result = await service.updateStatus('company-1', CompanyStatus.BLOCKED);

    expect(result.status).toBe(CompanyStatus.BLOCKED);
  });

  it('lança NotFoundException quando a empresa não existe', async () => {
    const { service } = makeService(null);
    await expect(service.updateStatus('company-inexistente', CompanyStatus.BLOCKED)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('CompaniesService.renew', () => {
  it('gera um novo ciclo de 30 dias a partir de hoje e volta o status para Ativo', async () => {
    const company = { id: 'company-1', status: CompanyStatus.BLOCKED, currentPeriodEnd: daysAgo(10) };
    const { service } = makeService(company);

    const result = await service.renew('company-1');

    expect(result.status).toBe(CompanyStatus.ACTIVE);
    const daysUntilDue = Math.round((result.currentPeriodEnd!.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    expect(daysUntilDue).toBeGreaterThanOrEqual(29);
    expect(daysUntilDue).toBeLessThanOrEqual(30);
  });
});

describe('CompaniesService.unlock', () => {
  it('marca lastManualUnlockAt e recalcula o status (Vencido, não Ativo, pois a mensalidade continua em atraso)', async () => {
    const company = { id: 'company-1', status: CompanyStatus.BLOCKED, currentPeriodEnd: daysAgo(10), lastManualUnlockAt: null };
    const { service } = makeService(company);

    const result = await service.unlock('company-1');

    expect(result.lastManualUnlockAt).toBeInstanceOf(Date);
    expect(result.status).toBe(CompanyStatus.PAST_DUE);
  });
});

describe('CompaniesService.remove', () => {
  it('define o contexto de tenant e apaga a empresa dentro de uma transação (para o cascade enxergar as linhas via RLS)', async () => {
    const company = { id: 'company-1', status: CompanyStatus.ACTIVE };
    const { service, dataSource } = makeService(company);
    const query = jest.fn();
    const del = jest.fn();
    (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => cb({ query, delete: del }));

    await service.remove('company-1');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('set_config'), ['company-1']);
    expect(del).toHaveBeenCalled();
  });

  it('lança NotFoundException quando a empresa não existe', async () => {
    const { service } = makeService(null);
    await expect(service.remove('company-inexistente')).rejects.toThrow(NotFoundException);
  });
});

describe('CompaniesService — configurações de conferência de descarte', () => {
  const COMPANY_ID = 'company-1';

  function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
    return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
  }

  it('getMySettings retorna as configurações da própria empresa', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: COMPANY_ID, lossVerificationEnabled: true, lossVerifierId: 'user-2' }),
    };
    const { service } = makeService(null);

    const result = await runWithTenantContext(manager, () => service.getMySettings());

    expect(result).toEqual({ lossVerificationEnabled: true, lossVerifierId: 'user-2' });
  });

  it('updateMySettings ativa a conferência e define o conferente', async () => {
    const company = { id: COMPANY_ID, lossVerificationEnabled: false, lossVerifierId: null };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(company).mockResolvedValueOnce({ id: 'user-2' }),
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
    };
    const { service } = makeService(null);

    const result = await runWithTenantContext(manager, () =>
      service.updateMySettings({ lossVerificationEnabled: true, lossVerifierId: 'user-2' }),
    );

    expect(result).toEqual({ lossVerificationEnabled: true, lossVerifierId: 'user-2' });
  });

  it('updateMySettings rejeita um conferente que não existe na empresa', async () => {
    const company = { id: COMPANY_ID, lossVerificationEnabled: false, lossVerifierId: null };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(company).mockResolvedValueOnce(null),
      save: jest.fn(),
    };
    const { service } = makeService(null);

    await expect(
      runWithTenantContext(manager, () => service.updateMySettings({ lossVerifierId: 'user-inexistente' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('updateMySettings permite limpar o conferente enviando null', async () => {
    const company = { id: COMPANY_ID, lossVerificationEnabled: true, lossVerifierId: 'user-2' };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(company),
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
    };
    const { service } = makeService(null);

    const result = await runWithTenantContext(manager, () => service.updateMySettings({ lossVerifierId: null }));

    expect(result.lossVerifierId).toBeNull();
  });
});

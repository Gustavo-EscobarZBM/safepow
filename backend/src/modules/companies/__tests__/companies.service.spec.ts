import { NotFoundException } from '@nestjs/common';
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

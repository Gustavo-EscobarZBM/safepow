import { computeEffectiveStatus } from './company-status.util';
import { CompanyStatus } from './company.entity';

function company(overrides: Partial<{ status: CompanyStatus; currentPeriodEnd: Date | null; lastManualUnlockAt: Date | null }>) {
  return {
    status: CompanyStatus.ACTIVE,
    currentPeriodEnd: new Date(),
    lastManualUnlockAt: null,
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('computeEffectiveStatus', () => {
  it('é Ativo quando o vencimento ainda não passou', () => {
    const result = computeEffectiveStatus(company({ currentPeriodEnd: daysAgo(-5) }));
    expect(result).toBe(CompanyStatus.ACTIVE);
  });

  it('é Vencido entre 1 e 3 dias de atraso', () => {
    expect(computeEffectiveStatus(company({ currentPeriodEnd: daysAgo(1) }))).toBe(CompanyStatus.PAST_DUE);
    expect(computeEffectiveStatus(company({ currentPeriodEnd: daysAgo(3) }))).toBe(CompanyStatus.PAST_DUE);
  });

  it('é Bloqueado com mais de 3 dias de atraso', () => {
    expect(computeEffectiveStatus(company({ currentPeriodEnd: daysAgo(4) }))).toBe(CompanyStatus.BLOCKED);
  });

  it('mantém CANCELED como estado terminal, ignorando o vencimento', () => {
    const result = computeEffectiveStatus(
      company({ status: CompanyStatus.CANCELED, currentPeriodEnd: daysAgo(-30) }),
    );
    expect(result).toBe(CompanyStatus.CANCELED);
  });

  it('trata como Vencido (não Bloqueado) quando desbloqueada manualmente após o vencimento atual', () => {
    const currentPeriodEnd = daysAgo(10);
    const lastManualUnlockAt = daysAgo(1); // desbloqueio veio depois do vencimento
    const result = computeEffectiveStatus(company({ currentPeriodEnd, lastManualUnlockAt }));
    expect(result).toBe(CompanyStatus.PAST_DUE);
  });

  it('volta a bloquear automaticamente se o desbloqueio manual for anterior ao vencimento atual', () => {
    const currentPeriodEnd = daysAgo(10);
    const lastManualUnlockAt = daysAgo(20); // desbloqueio de um ciclo anterior, já superado
    const result = computeEffectiveStatus(company({ currentPeriodEnd, lastManualUnlockAt }));
    expect(result).toBe(CompanyStatus.BLOCKED);
  });
});

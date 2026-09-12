import { Company, CompanyStatus } from './company.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type StatusInput = Pick<Company, 'status' | 'currentPeriodEnd' | 'lastManualUnlockAt'>;

/**
 * Deriva o status "de verdade" da empresa a partir do vencimento
 * (currentPeriodEnd), em vez de confiar cegamente no valor gravado. Regra do
 * Painel Master: em dia = Ativo; 1 a 3 dias de atraso = Vencido; mais de 3
 * dias = Bloqueado — automaticamente, sem intervenção manual.
 *
 * Exceção: se o Master usou "Desbloquear" (lastManualUnlockAt) depois do
 * vencimento atual, o bloqueio automático é suspenso para este ciclo — a
 * empresa volta a ser tratada como Vencida (não Ativa: ela ainda deve) até
 * que um "Renovar" gere um novo vencimento.
 *
 * CANCELED é estado terminal deste fluxo (cancelamento via webhook de
 * cobrança) e nunca é sobrescrito por esta regra.
 */
export function computeEffectiveStatus(company: StatusInput, now: Date = new Date()): CompanyStatus {
  if (company.status === CompanyStatus.CANCELED) {
    return CompanyStatus.CANCELED;
  }

  if (!company.currentPeriodEnd) {
    return company.status;
  }

  const daysLate = Math.floor((now.getTime() - new Date(company.currentPeriodEnd).getTime()) / MS_PER_DAY);

  if (daysLate <= 0) {
    return CompanyStatus.ACTIVE;
  }

  if (daysLate <= 3) {
    return CompanyStatus.PAST_DUE;
  }

  const unlockedThisCycle =
    !!company.lastManualUnlockAt && new Date(company.lastManualUnlockAt) >= new Date(company.currentPeriodEnd);

  return unlockedThisCycle ? CompanyStatus.PAST_DUE : CompanyStatus.BLOCKED;
}

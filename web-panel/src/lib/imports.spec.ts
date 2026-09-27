import { describe, expect, it } from 'vitest';
import { describeDiff, isPolling, stepForJob, type ImportJob, type ImportJobStatus } from './imports';

function job(status: ImportJobStatus, options: ImportJob['options'] = null): ImportJob {
  return { id: 'j1', status, options } as ImportJob;
}

describe('stepForJob', () => {
  it.each<[ImportJobStatus, string]>([
    ['uploaded', 'columns'],
    ['simulating', 'simulation'],
    ['simulated', 'simulation'],
    ['pending_approval', 'result'],
    ['applying', 'result'],
    ['completed', 'result'],
    ['cancelled', 'result'],
    ['rolling_back', 'result'],
    ['rolled_back', 'result'],
  ])('%s ⇒ %s', (status, step) => {
    expect(stepForJob(job(status))).toBe(step);
  });

  it('simulação que falhou (sem applyStartedAt) volta para as colunas', () => {
    expect(stepForJob(job('failed', { updateFields: [] }))).toBe('columns');
    expect(stepForJob(job('failed'))).toBe('columns');
  });

  it('gravação que falhou (com applyStartedAt) fica no resultado', () => {
    expect(stepForJob(job('failed', { updateFields: [], applyStartedAt: '2026-09-27T10:00:00Z' }))).toBe('result');
  });
});

describe('isPolling', () => {
  it('consulta só enquanto simula, grava ou reverte', () => {
    expect(isPolling('simulating')).toBe(true);
    expect(isPolling('applying')).toBe(true);
    expect(isPolling('rolling_back')).toBe(true);
    expect(isPolling('simulated')).toBe(false);
    expect(isPolling('completed')).toBe(false);
    expect(isPolling('failed')).toBe(false);
  });
});

describe('describeDiff', () => {
  it('preço em reais, nome e reativação', () => {
    expect(
      describeDiff({
        isActive: { from: false, to: true },
        name: { from: 'Arroz', to: 'Arroz 5kg' },
        unitPrice: { from: '10.00', to: 12 },
      }).map((line) => line.replace(/\s/g, ' ')),
    ).toEqual(['Reativar', 'Nome: Arroz → Arroz 5kg', 'Preço de venda: R$ 10,00 → R$ 12,00']);
  });

  it('valor antigo vazio aparece como "—"; sem diff ⇒ lista vazia', () => {
    expect(describeDiff({ sku: { from: null, to: 'A1' } })).toEqual(['SKU: — → A1']);
    expect(describeDiff(null)).toEqual([]);
  });
});

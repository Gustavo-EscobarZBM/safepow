import { approvalModeFor, normalizePolicies, priceChangeExceeds } from './approval-policies';

describe('priceChangeExceeds', () => {
  const before = { unitPrice: '10.00', costPrice: '6.00' };

  it('exatamente no limite não é sensível; um centavo acima é', () => {
    expect(priceChangeExceeds(before, { unitPrice: 12 }, 20)).toBe(false);
    expect(priceChangeExceeds(before, { unitPrice: 12.01 }, 20)).toBe(true);
    expect(priceChangeExceeds(before, { unitPrice: 8 }, 20)).toBe(false);
    expect(priceChangeExceeds(before, { unitPrice: 7.99 }, 20)).toBe(true);
  });

  it('decimais que enganam o ponto flutuante (0,10 → 0,12 com 20%) não viram sensíveis', () => {
    expect(priceChangeExceeds({ unitPrice: '0.10', costPrice: '0' }, { unitPrice: 0.12 }, 20)).toBe(false);
  });

  it('custo também conta; campo ausente no DTO não conta', () => {
    expect(priceChangeExceeds(before, { costPrice: 9 }, 20)).toBe(true);
    expect(priceChangeExceeds(before, {}, 20)).toBe(false);
  });

  it('valor anterior zero nunca é sensível (preencher preço zerado)', () => {
    expect(priceChangeExceeds({ unitPrice: '0.00', costPrice: '0.00' }, { unitPrice: 50, costPrice: 30 }, 20)).toBe(false);
  });
});

describe('approvalModeFor', () => {
  it('0 ou 1 gerente ⇒ justificativa; 2 ou mais ⇒ aprovação', () => {
    expect(approvalModeFor(0)).toBe('justification');
    expect(approvalModeFor(1)).toBe('justification');
    expect(approvalModeFor(2)).toBe('approval');
    expect(approvalModeFor(5)).toBe('approval');
  });
});

describe('normalizePolicies', () => {
  it('vazio ⇒ tudo desligado e limite padrão 20', () => {
    expect(normalizePolicies({})).toEqual({
      price_change: { enabled: false, thresholdPercent: 20 },
      retro_fix: { enabled: false },
      loss_edit: { enabled: false },
      archive_with_history: { enabled: false },
    });
    expect(normalizePolicies(null)).toEqual(normalizePolicies({}));
  });

  it('mantém o que foi ligado e ignora lixo', () => {
    const policies = normalizePolicies({
      price_change: { enabled: true, thresholdPercent: 35 },
      loss_edit: { enabled: 'sim' },
      desconhecida: { enabled: true },
    });
    expect(policies.price_change).toEqual({ enabled: true, thresholdPercent: 35 });
    expect(policies.loss_edit.enabled).toBe(false);
    expect(Object.keys(policies)).toEqual(['price_change', 'retro_fix', 'loss_edit', 'archive_with_history']);
  });

  it('limite inválido volta ao padrão', () => {
    expect(normalizePolicies({ price_change: { enabled: true, thresholdPercent: -5 } }).price_change.thresholdPercent).toBe(20);
  });
});

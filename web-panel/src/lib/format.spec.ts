import { describe, expect, it } from 'vitest';
import { formatBRL, formatDateShortBR } from './format';

describe('formatBRL', () => {
  it('formats a positive number as BRL currency', () => {
    expect(formatBRL(1234.5)).toMatch(/R\$\s*1\.234,50/);
  });

  it('formats zero as BRL currency', () => {
    expect(formatBRL(0)).toMatch(/R\$\s*0,00/);
  });

  it('accepts Intl.NumberFormatOptions overrides', () => {
    expect(formatBRL(1234.5, { maximumFractionDigits: 0 })).toMatch(/R\$\s*1\.235/);
  });
});

describe('formatDateShortBR', () => {
  it('formats an ISO date as dd/mm', () => {
    expect(formatDateShortBR('2026-03-05T12:00:00.000Z')).toBe('05/03');
  });
});

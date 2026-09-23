import { describe, expect, it } from 'vitest';
import { greetingForHour } from './greeting';

describe('greetingForHour', () => {
  it('greets with "Bom dia" from 5h to 11h', () => {
    expect(greetingForHour(5)).toBe('Bom dia');
    expect(greetingForHour(11)).toBe('Bom dia');
  });

  it('greets with "Boa tarde" from 12h to 17h', () => {
    expect(greetingForHour(12)).toBe('Boa tarde');
    expect(greetingForHour(17)).toBe('Boa tarde');
  });

  it('greets with "Boa noite" from 18h until 4h', () => {
    expect(greetingForHour(18)).toBe('Boa noite');
    expect(greetingForHour(23)).toBe('Boa noite');
    expect(greetingForHour(0)).toBe('Boa noite');
    expect(greetingForHour(4)).toBe('Boa noite');
  });
});

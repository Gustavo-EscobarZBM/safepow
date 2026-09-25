import { BadRequestException } from '@nestjs/common';
import { resolveRetroFixWindow } from './products-retro-fix';

describe('resolveRetroFixWindow', () => {
  const now = new Date('2026-09-25T15:00:00Z');

  it('sem "to" ⇒ até agora', () => {
    expect(resolveRetroFixWindow('2026-09-01T00:00:00Z', undefined, now)).toEqual({
      from: new Date('2026-09-01T00:00:00Z'),
      to: now,
    });
  });

  it('from futuro ⇒ 400', () => {
    expect(() => resolveRetroFixWindow('2026-09-26T00:00:00Z', undefined, now)).toThrow(
      new BadRequestException('A data inicial não pode ser futura.'),
    );
  });

  it('to antes de from ⇒ 400', () => {
    expect(() => resolveRetroFixWindow('2026-09-10T00:00:00Z', '2026-09-01T00:00:00Z', now)).toThrow(
      'A data final não pode ser anterior à inicial.',
    );
  });

  it('janela acima de 366 dias ⇒ 400; exatamente 366 dias ⇒ ok', () => {
    expect(() => resolveRetroFixWindow('2025-09-01T00:00:00Z', '2026-09-03T00:00:00Z', now)).toThrow(
      'A janela máxima é de 366 dias por correção.',
    );
    expect(resolveRetroFixWindow('2025-09-24T15:00:00Z', undefined, now).from).toEqual(new Date('2025-09-24T15:00:00Z'));
  });
});

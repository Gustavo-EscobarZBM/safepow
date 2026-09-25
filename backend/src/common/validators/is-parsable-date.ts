import { ValidateBy } from 'class-validator';

/**
 * @IsDateString aceita formatos ISO que o Date do JavaScript não entende (ex.: 20260924, 2026-W01) — sem esta
 * checagem viravam "Invalid Date" e o Postgres respondia com erro (500).
 */
export function IsParsableDate() {
  return ValidateBy({
    name: 'isParsableDate',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime()),
      defaultMessage: () => '$property deve ser uma data válida (ex.: 2026-09-24 ou 2026-09-24T10:00:00Z)',
    },
  });
}

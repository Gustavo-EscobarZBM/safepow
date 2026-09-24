import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateBy } from 'class-validator';

export const AUDIT_ENTITY_TYPES = [
  'product', 'loss_reason', 'loss_location', 'loss', 'user', 'company', 'company_revenue', 'import_job',
  'session', 'change_request',
] as const;
export const AUDIT_ACTIONS = [
  'create', 'update', 'archive', 'restore', 'delete', 'import', 'login', 'login_failed', 'approve', 'reject',
  'retro_fix', 'request', 'justify',
] as const;

/**
 * @IsDateString aceita formatos ISO que o Date do JavaScript não entende (ex.: 20260924, 2026-W01) — sem esta
 * checagem viravam "Invalid Date" e o Postgres respondia com erro (500).
 */
function IsParsableDate() {
  return ValidateBy({
    name: 'isParsableDate',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime()),
      defaultMessage: () => '$property deve ser uma data válida (ex.: 2026-09-24 ou 2026-09-24T10:00:00Z)',
    },
  });
}

/** Filtros da auditoria (GET /audit e /audit/export). */
export class QueryAuditDto {
  @IsOptional() @IsIn(AUDIT_ENTITY_TYPES) entityType?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsIn(AUDIT_ACTIONS) action?: string;
  @IsOptional() @IsDateString() @IsParsableDate() from?: string;
  @IsOptional() @IsDateString() @IsParsableDate() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

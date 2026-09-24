import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { SYNC_CURSOR_PATTERN, SYNC_MAX_LIMIT } from '../products-sync';

/** Query de GET /products (sync do app — spec do SP1, 6.1). Tudo opcional; sem nada = comportamento antigo. */
export class SyncProductsQueryDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  // Query string chega como texto: só "true"/"false" viram booleano; o resto falha na validação.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SYNC_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Matches(SYNC_CURSOR_PATTERN, { message: 'after deve ser um cursor de sync válido' })
  after?: string;
}

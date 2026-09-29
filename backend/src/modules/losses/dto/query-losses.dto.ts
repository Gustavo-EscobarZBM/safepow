import { IsIn, IsOptional, IsISO8601 } from 'class-validator';

export class QueryLossesDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Perdas por categoria (SP4 4.1): `root` (padrão) soma as subcategorias na de primeiro nível. */
export class QueryLossesByCategoryDto extends QueryLossesDto {
  @IsOptional()
  @IsIn(['root', 'leaf'])
  level?: 'root' | 'leaf';
}

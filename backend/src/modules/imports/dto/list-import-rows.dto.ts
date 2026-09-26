import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const ROW_FILTERS = ['create', 'update', 'reactivate', 'unchanged', 'error', 'duplicate', 'archive', 'warnings'] as const;
export type RowFilter = (typeof ROW_FILTERS)[number];

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListImportRowsDto extends PageQueryDto {
  /** Uma ação, ou `warnings` para as linhas com aviso. */
  @IsOptional()
  @IsIn(ROW_FILTERS)
  action?: RowFilter;
}

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE, MAX_PAGE_SIZE } from '../products-search';

export const PRODUCT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

export const PRODUCT_SORTS = ['name', 'updatedAt'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Query de GET /products/search (spec do SP1, seção 5.1). Tudo opcional; padrões no serviço. */
export class SearchProductsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUS_FILTERS)
  status?: ProductStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;
}

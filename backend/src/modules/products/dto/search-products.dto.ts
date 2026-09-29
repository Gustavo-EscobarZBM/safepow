import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PRODUCT_UNITS, ProductUnit } from '../product.entity';
import { MAX_PAGE, MAX_PAGE_SIZE } from '../products-search';

export const PRODUCT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

export const PRODUCT_SORTS = ['name', 'updatedAt'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Filtros de catálogo (SP4 4.1), comuns à busca e à exportação. */
export class ProductCatalogFiltersDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsIn(PRODUCT_UNITS)
  unit?: ProductUnit;
}

/** Query de GET /products/search (spec do SP1, seção 5.1). Tudo opcional; padrões no serviço. */
export class SearchProductsDto extends ProductCatalogFiltersDto {
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

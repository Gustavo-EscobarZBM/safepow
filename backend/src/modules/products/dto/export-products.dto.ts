import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ExportFormatDto } from '../../exports/dto/export-format.dto';
import { PRODUCT_UNITS, ProductUnit } from '../product.entity';
import { PRODUCT_STATUS_FILTERS, ProductStatusFilter } from './search-products.dto';

/** Query de GET /products/export: os mesmos filtros da busca da tela (status padrão = active), inclusive os do SP4 4.1. */
export class ExportProductsDto extends ExportFormatDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUS_FILTERS)
  status?: ProductStatusFilter;

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

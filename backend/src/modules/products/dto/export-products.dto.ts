import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ExportFormatDto } from '../../exports/dto/export-format.dto';
import { PRODUCT_STATUS_FILTERS, ProductStatusFilter } from './search-products.dto';

/** Query de GET /products/export: os mesmos filtros da busca da tela (status padrão = active). */
export class ExportProductsDto extends ExportFormatDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUS_FILTERS)
  status?: ProductStatusFilter;
}

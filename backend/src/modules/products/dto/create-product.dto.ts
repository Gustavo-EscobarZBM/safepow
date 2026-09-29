import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ProductCatalogFieldsDto } from './product-catalog-fields.dto';

export class CreateProductDto extends ProductCatalogFieldsDto {
  @IsString()
  @MinLength(1)
  barcode: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  // Até 4 casas desde o SP4 4.1 (custo de item fracionado).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice?: number;
}

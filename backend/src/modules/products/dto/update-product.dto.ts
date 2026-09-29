import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { ProductCatalogFieldsDto } from './product-catalog-fields.dto';

export class UpdateProductDto extends ProductCatalogFieldsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  barcode?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice?: number;

  // Mesmas regras de JustificationDto (SP2, 2.2) — repetidas aqui porque a classe já herda os campos de catálogo.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'A justificativa precisa ter pelo menos 10 caracteres.' })
  @MaxLength(1000)
  justification?: string;
}

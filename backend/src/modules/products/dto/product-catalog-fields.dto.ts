import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';
import { PRODUCT_UNITS, ProductUnit } from '../product.entity';

const nullable = ValidateIf((_, value) => value !== null);

/** Campos de catálogo do produto (SP4 4.1), comuns à criação e à edição. `null` limpa o campo. */
export class ProductCatalogFieldsDto {
  @IsOptional()
  @nullable
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @nullable
  @IsUUID()
  brandId?: string | null;

  @IsOptional()
  @nullable
  @IsUUID()
  supplierId?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_UNITS, { message: `Unidade inválida. Use uma de: ${PRODUCT_UNITS.join(', ')}.` })
  unit?: ProductUnit;

  @IsOptional()
  @IsBoolean()
  isPerishable?: boolean;

  @IsOptional()
  @nullable
  @IsInt()
  @Min(1)
  shelfLifeDays?: number | null;

  @IsOptional()
  @nullable
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @IsOptional()
  @nullable
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export const PRODUCT_CATALOG_FIELDS = [
  'categoryId',
  'brandId',
  'supplierId',
  'unit',
  'isPerishable',
  'shelfLifeDays',
  'imageUrl',
  'notes',
] as const;

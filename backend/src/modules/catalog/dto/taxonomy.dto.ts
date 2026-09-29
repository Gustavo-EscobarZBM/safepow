import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

/** ">" separa os níveis da categoria na planilha ("Mercearia > Bebidas"): não pode fazer parte do nome. */
const NO_LEVEL_SEPARATOR = Matches(/^[^>]*$/, { message: 'O nome da categoria não pode ter ">" (é o separador de níveis).' });

export class ListTaxonomyQueryDto {
  @IsOptional()
  @IsString()
  includeArchived?: string;
}

export class CreateBrandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;
}

export class CreateCategoryDto extends CreateBrandDto {
  @NO_LEVEL_SEPARATOR
  declare name: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;
}

export class UpdateCategoryDto extends UpdateBrandDto {
  @NO_LEVEL_SEPARATOR
  declare name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;
}

class SupplierContactFields {
  @IsOptional()
  @IsString()
  @MaxLength(18)
  taxId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsEmail({}, { message: 'E-mail inválido.' })
  @MaxLength(160)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateSupplierDto extends SupplierContactFields {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}

export class UpdateSupplierDto extends SupplierContactFields {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;
}

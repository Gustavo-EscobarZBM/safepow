import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class SimulateImportDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  sheetName?: string;

  /** Campo do handler ⇒ cabeçalho da planilha. */
  @IsObject()
  mapping: Record<string, string>;

  /** Campos que a importação pode alterar em registros que já existem. */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  updateFields: string[];

  @IsOptional()
  @IsString()
  @Length(1, 80)
  saveMappingAs?: string;
}

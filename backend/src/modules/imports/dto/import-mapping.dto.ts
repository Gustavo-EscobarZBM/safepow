import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class SaveImportMappingDto {
  @IsString()
  @Length(1, 40)
  resource: string;

  @IsString()
  @Length(1, 80)
  name: string;

  /** Campo do handler ⇒ cabeçalho da planilha. */
  @IsObject()
  mapping: Record<string, string>;

  /** Cabeçalhos da planilha em que o mapeamento foi montado (viram o fingerprint). */
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  headers: string[];
}

export class PreviewImportDto {
  /** Sem aba (retomada da tela, ou CSV) ⇒ a aba atual do job. */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  sheetName?: string;
}

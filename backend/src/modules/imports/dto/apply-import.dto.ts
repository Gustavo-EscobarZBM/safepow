import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class ApplyImportDto {
  @IsOptional()
  @IsBoolean()
  archiveMissing?: boolean;

  /** Número de ausentes digitado pelo gerente (confirmação forte acima de 20% do catálogo). */
  @IsOptional()
  @IsInt()
  @Min(0)
  confirmArchiveCount?: number;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  justification?: string;
}

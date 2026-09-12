import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  cnpj?: string;

  @IsOptional()
  @IsString()
  planTier?: string;

  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;
}

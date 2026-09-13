import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsBoolean()
  lossVerificationEnabled?: boolean;

  // Undefined = não mexe; null = limpa o conferente; string = define um novo.
  @IsOptional()
  @IsUUID()
  lossVerifierId?: string | null;
}

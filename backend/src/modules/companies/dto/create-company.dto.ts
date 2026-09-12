import { IsDateString, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  cnpj?: string;

  @IsOptional()
  @IsString()
  planTier?: string;

  // Primeiro vencimento da mensalidade. O Painel Master sugere hoje + 30 dias,
  // mas o Administrador Master pode ajustar manualmente no cadastro.
  @IsOptional()
  @IsDateString()
  firstDueDate?: string;

  // Dados do primeiro usuário (gerente) da empresa, criado junto com o tenant.
  @IsString()
  @MinLength(2)
  managerName: string;

  @IsEmail()
  managerEmail: string;

  @IsString()
  @MinLength(6)
  managerPassword: string;
}

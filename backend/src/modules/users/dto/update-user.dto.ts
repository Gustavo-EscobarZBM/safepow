import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Mesma restrição do convite (InviteUserDto) — master_admin nunca é atribuído por aqui.
  @IsOptional()
  @IsEnum([UserRole.MANAGER, UserRole.EMPLOYEE], {
    message: 'role deve ser "manager" ou "employee".',
  })
  role?: UserRole.MANAGER | UserRole.EMPLOYEE;

  // Opcional: só troca a senha se o gerente preencher este campo.
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}

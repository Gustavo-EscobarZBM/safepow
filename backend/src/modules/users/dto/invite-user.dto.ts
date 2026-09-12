import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { UserRole } from '../user.entity';

export class InviteUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  // Só permite convidar papéis dentro da própria empresa — master_admin nunca
  // é criado por aqui (só pelo seed inicial do sistema).
  @IsEnum([UserRole.MANAGER, UserRole.EMPLOYEE], {
    message: 'role deve ser "manager" ou "employee".',
  })
  role: UserRole.MANAGER | UserRole.EMPLOYEE;
}

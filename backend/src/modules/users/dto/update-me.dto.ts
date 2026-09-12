import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Obrigatória junto de newPassword — confirma que quem está trocando a
  // senha é realmente o dono da conta, mesma cautela de qualquer troca de
  // senha autoatendida.
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  newPassword?: string;
}

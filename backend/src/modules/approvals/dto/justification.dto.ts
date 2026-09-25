import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Justificativa de mudança sensível (SP2, 2.2): mín. 10 caracteres úteis — espaços nas pontas não contam. */
export class JustificationDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'A justificativa precisa ter pelo menos 10 caracteres.' })
  @MaxLength(1000)
  justification?: string;
}

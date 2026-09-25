import { Transform, Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { IsParsableDate } from '../../../common/validators/is-parsable-date';

/** Prévia da correção retroativa (GET /products/:id/retro-fix/preview). */
export class RetroFixQueryDto {
  @IsDateString() @IsParsableDate() from: string;
  @IsOptional() @IsDateString() @IsParsableDate() to?: string;
  @Type(() => Number) @IsNumber() @Min(0) unitPrice: number;
  @Type(() => Number) @IsNumber() @Min(0) costPrice: number;
}

/** Aplicação (POST /products/:id/retro-fix): a justificativa é sempre obrigatória (SP2, seção 4). */
export class RetroFixDto extends RetroFixQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'A justificativa precisa ter pelo menos 10 caracteres.' })
  @MaxLength(1000)
  justification: string;
}

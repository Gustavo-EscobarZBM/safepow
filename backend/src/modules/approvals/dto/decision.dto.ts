import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

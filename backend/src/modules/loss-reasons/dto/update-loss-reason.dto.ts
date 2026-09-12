import { IsString, MinLength } from 'class-validator';

export class UpdateLossReasonDto {
  @IsString()
  @MinLength(1)
  name: string;
}

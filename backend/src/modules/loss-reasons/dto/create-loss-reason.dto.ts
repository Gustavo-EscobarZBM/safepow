import { IsString, MinLength } from 'class-validator';

export class CreateLossReasonDto {
  @IsString()
  @MinLength(1)
  name: string;
}

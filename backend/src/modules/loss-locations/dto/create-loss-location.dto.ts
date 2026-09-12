import { IsString, MinLength } from 'class-validator';

export class CreateLossLocationDto {
  @IsString()
  @MinLength(1)
  name: string;
}

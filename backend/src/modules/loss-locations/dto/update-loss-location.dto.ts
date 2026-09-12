import { IsString, MinLength } from 'class-validator';

export class UpdateLossLocationDto {
  @IsString()
  @MinLength(1)
  name: string;
}

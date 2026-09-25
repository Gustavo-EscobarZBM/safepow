import { IsIn, IsOptional } from 'class-validator';

export class ListChangeRequestsDto {
  @IsOptional()
  @IsIn(['pending', 'decided'])
  status?: 'pending' | 'decided';
}

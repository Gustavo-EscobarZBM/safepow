import { IsNumber, Min } from 'class-validator';

export class UpsertCompanyRevenueDto {
  @IsNumber()
  @Min(0)
  revenueAmount: number;
}

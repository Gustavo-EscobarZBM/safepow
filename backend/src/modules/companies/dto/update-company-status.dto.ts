import { IsEnum } from 'class-validator';
import { CompanyStatus } from '../company.entity';

export class UpdateCompanyStatusDto {
  @IsEnum(CompanyStatus, { message: 'Status inválido.' })
  status: CompanyStatus;
}

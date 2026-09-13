import { BadRequestException, Injectable } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { CompanyMonthlyRevenue } from './company-monthly-revenue.entity';
import { UpsertCompanyRevenueDto } from './dto/upsert-company-revenue.dto';

@Injectable()
export class CompanyRevenueService {
  private assertValidMonth(month: number): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mês inválido: deve ser um número entre 1 e 12.');
    }
  }

  async upsert(year: number, month: number, dto: UpsertCompanyRevenueDto): Promise<CompanyMonthlyRevenue> {
    this.assertValidMonth(month);
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const existing = await manager.findOne(CompanyMonthlyRevenue, {
      where: { companyId: companyId!, year, month },
    });
    if (existing) {
      existing.revenueAmount = dto.revenueAmount;
      return manager.save(existing);
    }

    const revenue = manager.create(CompanyMonthlyRevenue, {
      companyId: companyId!,
      year,
      month,
      revenueAmount: dto.revenueAmount,
    });
    return manager.save(revenue);
  }

  async find(year: number, month: number): Promise<CompanyMonthlyRevenue | null> {
    this.assertValidMonth(month);
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    return manager.findOne(CompanyMonthlyRevenue, { where: { companyId: companyId!, year, month } });
  }
}

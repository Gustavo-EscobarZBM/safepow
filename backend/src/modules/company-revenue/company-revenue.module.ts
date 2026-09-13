import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { CompanyMonthlyRevenue } from './company-monthly-revenue.entity';
import { CompanyRevenueController } from './company-revenue.controller';
import { CompanyRevenueService } from './company-revenue.service';

@Module({
  // Company precisa estar registrada aqui porque o SubscriptionGuard (usado no
  // controller) injeta o repositório de Company.
  imports: [TypeOrmModule.forFeature([CompanyMonthlyRevenue, Company])],
  controllers: [CompanyRevenueController],
  providers: [CompanyRevenueService],
  exports: [CompanyRevenueService],
})
export class CompanyRevenueModule {}

import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CompanyRevenueService } from './company-revenue.service';
import { UpsertCompanyRevenueDto } from './dto/upsert-company-revenue.dto';

// Faturamento mensal informado pelo gerente — usado só para a taxa de perda
// sobre faturamento no dashboard (spec seção 3). Restrito a MANAGER.
@Controller('company-revenue')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class CompanyRevenueController {
  constructor(private readonly companyRevenueService: CompanyRevenueService) {}

  @Put(':year/:month')
  upsert(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: UpsertCompanyRevenueDto,
  ) {
    return this.companyRevenueService.upsert(year, month, dto);
  }

  @Get()
  find(@Query('year', ParseIntPipe) year: number, @Query('month', ParseIntPipe) month: number) {
    return this.companyRevenueService.find(year, month);
  }
}

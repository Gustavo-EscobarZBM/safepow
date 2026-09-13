import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CompaniesService } from './companies.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

// Autoatendimento do gerente para as configurações da própria empresa — hoje
// só a conferência de descarte (spec seção 5). Distinto de /master/companies
// (Painel Master, MASTER_ADMIN, dados cadastrais/billing de qualquer empresa).
@Controller('companies/me')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class CompanySettingsController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('settings')
  getSettings() {
    return this.companiesService.getMySettings();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateCompanySettingsDto) {
    return this.companiesService.updateMySettings(dto);
  }
}

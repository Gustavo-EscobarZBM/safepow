import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { countActiveManagers, loadCompanyPolicies, saveCompanyPolicies } from './approval-gate';
import { approvalModeFor, normalizePolicies } from './approval-policies';
import { UpdateApprovalPoliciesDto } from './dto/update-approval-policies.dto';

/**
 * Políticas de aprovação da própria empresa (SP2, 2.2). A mudança é auditada pelo trigger de companies. O
 * `mode` diz ao painel o que vai acontecer hoje ("1 gerente: as mudanças sensíveis pedirão justificativa").
 */
@Controller('approval-policies')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ApprovalPoliciesController {
  @Get()
  async get() {
    return this.describe();
  }

  @Put()
  async update(@Body() dto: UpdateApprovalPoliciesDto) {
    await saveCompanyPolicies(normalizePolicies(dto));
    return this.describe();
  }

  private async describe() {
    const activeManagers = await countActiveManagers();
    return { policies: await loadCompanyPolicies(), activeManagers, mode: approvalModeFor(activeManagers) };
  }
}

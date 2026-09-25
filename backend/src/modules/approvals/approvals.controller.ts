import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { ApprovalsService } from './approvals.service';
import { DecisionDto } from './dto/decision.dto';
import { ListChangeRequestsDto } from './dto/list-change-requests.dto';

/** Fila de pedidos de aprovação (SP2, 2.2) — só gerente. */
@Controller('change-requests')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // Rota estática antes das com parâmetro (mesma regra da 1.3).
  @Get('pending-count')
  pendingCount() {
    return this.approvalsService.pendingCount();
  }

  @Get()
  list(@Query() query: ListChangeRequestsDto) {
    return this.approvalsService.list(query.status ?? 'pending');
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.approvalsService.approve(id, body?.note);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.approvalsService.reject(id, body?.note);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.approvalsService.cancel(id);
  }
}

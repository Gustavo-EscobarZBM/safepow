import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

/** Trilha de auditoria (SP2, 2.1) — só gerente até o papel "auditor" do SP7. */
@Controller('audit')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Rota estática antes da raiz com filtros (mesma regra da 1.3).
  @Get('export')
  @Roles(UserRole.MANAGER)
  async export(@Query() query: QueryAuditDto, @Res({ passthrough: true }) res: Response) {
    const csv = await this.auditService.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
    return csv;
  }

  @Get()
  @Roles(UserRole.MANAGER)
  list(@Query() query: QueryAuditDto) {
    return this.auditService.list(query);
  }
}

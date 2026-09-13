import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CreateLossDto } from './dto/create-loss.dto';
import { QueryLossesDto } from './dto/query-losses.dto';
import { UpdateLossDto } from './dto/update-loss.dto';
import { LossesService } from './losses.service';

@Controller('losses')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class LossesController {
  constructor(private readonly lossesService: LossesService) {}

  // Chamado pelo app mobile — tanto no registro em tempo real quanto pela fila
  // de sincronização offline reenviando registros pendentes (Seção 4 do documento).
  @Post()
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  create(@Body() dto: CreateLossDto) {
    return this.lossesService.create(dto);
  }

  // Edição/exclusão manual — exclusivas do gerente (correção de registros
  // errados, diferente do fluxo de registro em si, aberto a funcionários).
  @Patch(':id')
  @Roles(UserRole.MANAGER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLossDto) {
    return this.lossesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.lossesService.remove(id);
  }

  // Listagem detalhada — painel do gerente.
  @Get()
  @Roles(UserRole.MANAGER)
  findAll(@Query() query: QueryLossesDto) {
    return this.lossesService.findAll(query);
  }

  // Dados para os gráficos gerenciais (produtos mais perdidos, prejuízo financeiro).
  @Get('reports/by-product')
  @Roles(UserRole.MANAGER)
  reportByProduct(@Query() query: QueryLossesDto) {
    return this.lossesService.reportByProduct(query);
  }

  // KPIs do topo do dashboard: mês atual vs mês anterior.
  @Get('reports/summary')
  @Roles(UserRole.MANAGER)
  reportSummary() {
    return this.lossesService.reportSummary();
  }

  // Série temporal para o gráfico de tendência (linha/área).
  @Get('reports/by-period')
  @Roles(UserRole.MANAGER)
  reportByPeriod(@Query() query: QueryLossesDto) {
    return this.lossesService.reportByPeriod(query);
  }

  // Composição por motivo — gráfico de rosca.
  @Get('reports/by-reason')
  @Roles(UserRole.MANAGER)
  reportByReason(@Query() query: QueryLossesDto) {
    return this.lossesService.reportByReason(query);
  }

  // Composição por local — segunda visão do gráfico de rosca.
  @Get('reports/by-location')
  @Roles(UserRole.MANAGER)
  reportByLocation(@Query() query: QueryLossesDto) {
    return this.lossesService.reportByLocation(query);
  }

  // Card "Alertas e recomendações" do dashboard — regras fixas em losses-alerts.ts.
  @Get('reports/alerts')
  @Roles(UserRole.MANAGER)
  reportAlerts() {
    return this.lossesService.reportAlerts();
  }

  // Card "Padrões para revisar" do dashboard — score por funcionário em losses-suspicious-patterns.ts.
  @Get('reports/suspicious-patterns')
  @Roles(UserRole.MANAGER)
  reportSuspiciousPatterns() {
    return this.lossesService.reportSuspiciousPatterns();
  }

  // Card "Conferências pendentes" — acesso: MANAGER ou o funcionário
  // designado como conferente (checado dentro do service, não só por papel).
  @Get('pending-verification')
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  findPendingVerification() {
    return this.lossesService.findPendingVerification();
  }

  @Patch(':id/verify')
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  verify(@Param('id', ParseUUIDPipe) id: string) {
    return this.lossesService.verify(id);
  }

  // Exportação de planilha (Seção 5.3) — o gerente usa isso para dar baixa
  // no ERP principal da empresa.
  @Get('export')
  @Roles(UserRole.MANAGER)
  async export(@Query() query: QueryLossesDto, @Res() res: Response) {
    const buffer = await this.lossesService.exportToXlsx(query);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="perdas.xlsx"',
    });
    res.send(buffer);
  }
}

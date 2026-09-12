import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CreateLossReasonDto } from './dto/create-loss-reason.dto';
import { UpdateLossReasonDto } from './dto/update-loss-reason.dto';
import { LossReasonsService } from './loss-reasons.service';

@Controller('loss-reasons')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class LossReasonsController {
  constructor(private readonly lossReasonsService: LossReasonsService) {}

  // Cadastro pelo Painel > Cadastros > Motivo da Perda.
  @Post()
  @Roles(UserRole.MANAGER)
  create(@Body() dto: CreateLossReasonDto) {
    return this.lossReasonsService.create(dto);
  }

  // Alimenta tanto a tela de cadastro quanto o select de Motivo no registro de perda.
  @Get()
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  findAll() {
    return this.lossReasonsService.findAll();
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLossReasonDto) {
    return this.lossReasonsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.lossReasonsService.remove(id);
  }
}

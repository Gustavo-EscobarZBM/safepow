import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CreateLossLocationDto } from './dto/create-loss-location.dto';
import { UpdateLossLocationDto } from './dto/update-loss-location.dto';
import { LossLocationsService } from './loss-locations.service';

@Controller('loss-locations')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class LossLocationsController {
  constructor(private readonly lossLocationsService: LossLocationsService) {}

  // Cadastro pelo Painel > Cadastros > Local da Perda.
  @Post()
  @Roles(UserRole.MANAGER)
  create(@Body() dto: CreateLossLocationDto) {
    return this.lossLocationsService.create(dto);
  }

  // Alimenta tanto a tela de cadastro quanto o select de Local no registro de perda.
  @Get()
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  findAll() {
    return this.lossLocationsService.findAll();
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLossLocationDto) {
    return this.lossLocationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.lossLocationsService.remove(id);
  }
}

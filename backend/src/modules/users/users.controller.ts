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
import { Response } from 'express';
import { ExportFormatDto } from '../exports/dto/export-format.dto';
import { streamExport } from '../exports/export-writer';
import { usersExportHandler } from './users.export-handler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from './user.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Autoatendimento (Configurações > Meu perfil) — aberto aos 3 papéis, por
  // isso sobrescreve o @Roles(MANAGER) da classe. Precisa vir ANTES das rotas
  // ":id" abaixo, senão "me" seria capturado como um :id literal.
  @Get('me')
  @Roles(UserRole.MASTER_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  getMe() {
    return this.usersService.getMe();
  }

  @Patch('me')
  @Roles(UserRole.MASTER_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  updateMe(@Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(dto);
  }

  @Post()
  invite(@Body() dto: InviteUserDto) {
    return this.usersService.invite(dto);
  }

  // Exportação em streaming (SP3, 3.3). Rota estática antes das paramétricas.
  @Get('export')
  @Roles(UserRole.MANAGER)
  async export(@Query() query: ExportFormatDto, @Res() res: Response): Promise<void> {
    await streamExport(res, usersExportHandler, undefined, query.format ?? 'xlsx');
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.setActive(id, false);
  }

  @Patch(':id/reactivate')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.setActive(id, true);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}

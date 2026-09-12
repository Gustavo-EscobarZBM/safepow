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
  UseGuards,
} from '@nestjs/common';
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

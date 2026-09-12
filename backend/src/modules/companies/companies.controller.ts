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
import { UserRole } from '../users/user.entity';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateCompanyStatusDto } from './dto/update-company-status.dto';

// Todas as rotas aqui compõem o "Painel Master" descrito na Seção 6.1 do
// documento de arquitetura — visíveis apenas para MASTER_ADMIN (sua equipe).
@Controller('master/companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MASTER_ADMIN)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @Get()
  findAll() {
    return this.companiesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.findOneOrFail(id);
  }

  // Edição dos dados cadastrais (nome, CNPJ, plano, vencimento) — distinta de
  // updateStatus (bloqueio/reativação manual) e renew (ciclo de cobrança).
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyStatusDto) {
    return this.companiesService.updateStatus(id, dto.status);
  }

  @Patch(':id/renew')
  renew(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.renew(id);
  }

  @Patch(':id/unlock')
  unlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.unlock(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.remove(id);
  }
}

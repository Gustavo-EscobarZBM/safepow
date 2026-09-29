import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { ExportFormatDto } from '../exports/dto/export-format.dto';
import { streamExport } from '../exports/export-writer';
import { UserRole } from '../users/user.entity';
import { categoriesExportHandler } from './catalog.export-handlers';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, ListTaxonomyQueryDto, UpdateCategoryDto } from './dto/taxonomy.dto';

// Painel > Cadastros > Categorias (SP4 4.1). Leitura liberada ao funcionário (app/filtros).
@Controller('categories')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get('export')
  @Roles(UserRole.MANAGER)
  async export(@Query() query: ExportFormatDto, @Res() res: Response): Promise<void> {
    await streamExport(res, categoriesExportHandler, undefined, query.format ?? 'xlsx');
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  list(@Query() query: ListTaxonomyQueryDto) {
    return this.service.listWithPath(query.includeArchived === 'true');
  }

  @Post()
  @Roles(UserRole.MANAGER)
  async create(@Body() dto: CreateCategoryDto) {
    return this.service.withPath(await this.service.create(dto));
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.withPath(await this.service.update(id, dto));
  }

  @Post(':id/archive')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  async archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.withPath(await this.service.archive(id));
  }

  @Post(':id/restore')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.withPath(await this.service.restore(id));
  }
}

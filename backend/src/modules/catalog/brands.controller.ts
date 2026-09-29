import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { ExportFormatDto } from '../exports/dto/export-format.dto';
import { streamExport } from '../exports/export-writer';
import { UserRole } from '../users/user.entity';
import { BrandsService } from './brands-suppliers.services';
import { brandsExportHandler } from './catalog.export-handlers';
import { CreateBrandDto, ListTaxonomyQueryDto, UpdateBrandDto } from './dto/taxonomy.dto';

// Painel > Cadastros > Marcas (SP4 4.1).
@Controller('brands')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class BrandsController {
  constructor(private readonly service: BrandsService) {}

  @Get('export')
  @Roles(UserRole.MANAGER)
  async export(@Query() query: ExportFormatDto, @Res() res: Response): Promise<void> {
    await streamExport(res, brandsExportHandler, undefined, query.format ?? 'xlsx');
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  list(@Query() query: ListTaxonomyQueryDto) {
    return this.service.list(query.includeArchived === 'true');
  }

  @Post()
  @Roles(UserRole.MANAGER)
  create(@Body() dto: CreateBrandDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/archive')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.archive(id);
  }

  @Post(':id/restore')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.restore(id);
  }
}

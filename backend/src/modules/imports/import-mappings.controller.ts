import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { SaveImportMappingDto } from './dto/import-mapping.dto';
import { ImportMappingsService } from './import-mappings.service';

@Controller('import-mappings')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ImportMappingsController {
  constructor(private readonly mappings: ImportMappingsService) {}

  @Get()
  list(@Query('resource') resource = 'products') {
    return this.mappings.list(resource);
  }

  @Post()
  save(@Body() dto: SaveImportMappingDto) {
    return this.mappings.save(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.mappings.remove(id);
  }
}

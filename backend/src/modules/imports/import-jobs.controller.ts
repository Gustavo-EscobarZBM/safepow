import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { PreviewImportDto } from './dto/import-mapping.dto';
import { ImportJobsService } from './import-jobs.service';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** Importação 2.0 (SP3, spec 3). O fluxo antigo continua em /products/import até a etapa 3.2. */
@Controller('imports')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ImportJobsController {
  constructor(private readonly imports: ImportJobsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('resource') resource?: string) {
    return this.imports.upload(file, resource || 'products');
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.findOne(id);
  }

  @Post(':id/preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PreviewImportDto) {
    return this.imports.preview(id, dto.sheetName);
  }
}

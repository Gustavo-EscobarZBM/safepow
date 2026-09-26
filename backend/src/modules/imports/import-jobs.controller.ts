import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Query,
  StreamableFile,
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
import { ListImportRowsDto, PageQueryDto } from './dto/list-import-rows.dto';
import { SimulateImportDto } from './dto/simulate-import.dto';
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

  @Post(':id/simulate')
  @HttpCode(202)
  async simulate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateImportDto) {
    return { job: await this.imports.simulate(id, dto) };
  }

  @Get(':id/rows')
  rows(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListImportRowsDto) {
    return this.imports.listRows(id, query);
  }

  @Get(':id/missing')
  missing(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQueryDto) {
    return this.imports.listMissing(id, query);
  }

  @Get(':id/report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async report(@Param('id', ParseUUIDPipe) id: string) {
    const { buffer, fileName } = await this.imports.reportCsv(id);
    return new StreamableFile(buffer, { disposition: `attachment; filename="${encodeURIComponent(fileName)}"` });
  }
}

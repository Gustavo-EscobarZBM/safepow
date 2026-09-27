import {
  BadRequestException,
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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { ColumnMappingDto } from './dto/column-mapping.dto';
import { ImportJobsService } from './import-jobs.service';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * Endpoint antigo da tela de produtos (mapeamento digitado à mão). Desde a etapa 3.1.2 do SP3 roda sobre o motor
 * novo — simula e grava direto quando nenhuma política de aprovação se aplica — e responde no formato antigo.
 * Sai na etapa 3.2, quando o assistente de importação substituir a tela.
 */
@Controller('products/import')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ImportsController {
  constructor(private readonly importJobs: ImportJobsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body('mapping') mappingRaw: string) {
    let mappingObject: unknown;
    try {
      mappingObject = JSON.parse(mappingRaw);
    } catch {
      throw new BadRequestException(
        'Campo "mapping" precisa ser um JSON válido (ex: {"barcodeColumn":"EAN","nameColumn":"Descrição"}).',
      );
    }
    const mapping = plainToInstance(ColumnMappingDto, mappingObject);
    const errors = await validate(mapping);
    if (errors.length > 0) {
      throw new BadRequestException('Mapeamento de colunas inválido: ' + JSON.stringify(errors));
    }
    return this.importJobs.legacyImport(file, mapping);
  }

  @Get(':id')
  findStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.importJobs.legacyStatus(id);
  }
}

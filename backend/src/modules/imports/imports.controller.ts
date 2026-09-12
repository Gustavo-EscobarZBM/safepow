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
import { ImportsService } from './imports.service';

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',
];

@Controller('products/import')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingRaw: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhuma planilha enviada (campo "file").');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato inválido. Envie um arquivo .xlsx.');
    }

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

    return this.importsService.createImportJob(file, mapping);
  }

  @Get(':id')
  findStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.findJob(id);
  }
}

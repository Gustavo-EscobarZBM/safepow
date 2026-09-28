import { IsIn, IsOptional } from 'class-validator';
import { EXPORT_FORMATS, ExportFormat } from '../export-handler';

/** `?format=xlsx|csv` das rotas de exportação (padrão xlsx). */
export class ExportFormatDto {
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format?: ExportFormat;
}

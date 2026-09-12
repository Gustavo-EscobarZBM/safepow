import { IsOptional, IsString } from 'class-validator';

/**
 * Nomes das colunas EXATAMENTE como aparecem na planilha do cliente. Como
 * cada ERP nomeia as colunas de um jeito (Seção 5.4 do documento), o gerente
 * informa esse mapeamento uma vez pela tela de importação e o backend usa
 * para ler a planilha independentemente do nome original das colunas.
 */
export class ColumnMappingDto {
  @IsString()
  barcodeColumn: string;

  @IsString()
  nameColumn: string;

  @IsOptional()
  @IsString()
  skuColumn?: string;

  @IsOptional()
  @IsString()
  unitPriceColumn?: string;
}

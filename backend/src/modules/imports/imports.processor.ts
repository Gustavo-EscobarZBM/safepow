import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { Product } from '../products/product.entity';
import { StorageService } from '../uploads/storage.service';
import { PRODUCTS_IMPORT_QUEUE, ProductImportJobData } from './imports.service';
import { ImportJob, ImportJobStatus, ImportRowError } from './import-job.entity';

const MAX_ERROR_REPORT_ENTRIES = 200;
const HEADER_ROW_NUMBER = 1;
const FIRST_DATA_ROW_NUMBER = 2;

/**
 * Worker BullMQ (Seção 5.2 do documento): lê a planilha, valida linha a
 * linha e grava os produtos válidos. Roda em um processo separado do
 * servidor HTTP, então NUNCA passa pelo TenantContextMiddleware — por isso
 * abre sua própria transação e define app.current_company_id manualmente
 * (mesma técnica usada em CompaniesService.create), usando o companyId que
 * veio explicitamente nos dados do job, não de um token JWT.
 */
@Processor(PRODUCTS_IMPORT_QUEUE)
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProductImportJobData>): Promise<void> {
    const { importJobId, companyId, storageKey, mapping } = job.data;

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]);

      const importJob = await manager.findOne(ImportJob, { where: { id: importJobId } });
      if (!importJob) {
        this.logger.warn(`ImportJob ${importJobId} não encontrado — abortando.`);
        return;
      }

      importJob.status = ImportJobStatus.PROCESSING;
      await manager.save(importJob);

      const errorReport: ImportRowError[] = [];
      let successCount = 0;
      let totalRows = 0;

      try {
        const buffer = await this.storageService.downloadBuffer(storageKey);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
          throw new Error('A planilha não contém nenhuma aba/página.');
        }

        const headerRow = worksheet.getRow(HEADER_ROW_NUMBER);
        const columnIndexByHeader = new Map<string, number>();
        headerRow.eachCell((cell, colNumber) => {
          const header = String(cell.value ?? '').trim();
          if (header) columnIndexByHeader.set(header, colNumber);
        });

        const requiredColumns = [mapping.barcodeColumn, mapping.nameColumn];
        for (const col of requiredColumns) {
          if (!columnIndexByHeader.has(col)) {
            throw new Error(`Coluna "${col}" não encontrada no cabeçalho da planilha.`);
          }
        }

        const barcodeCol = columnIndexByHeader.get(mapping.barcodeColumn)!;
        const nameCol = columnIndexByHeader.get(mapping.nameColumn)!;
        const skuCol = mapping.skuColumn ? columnIndexByHeader.get(mapping.skuColumn) : undefined;
        const priceCol = mapping.unitPriceColumn
          ? columnIndexByHeader.get(mapping.unitPriceColumn)
          : undefined;

        for (let rowNumber = FIRST_DATA_ROW_NUMBER; rowNumber <= worksheet.rowCount; rowNumber++) {
          const row = worksheet.getRow(rowNumber);
          const isEmptyRow = row.cellCount === 0 || row.values === undefined;
          if (isEmptyRow) continue;

          totalRows++;

          try {
            const barcode = String(row.getCell(barcodeCol).value ?? '').trim();
            const name = String(row.getCell(nameCol).value ?? '').trim();
            const sku = skuCol ? String(row.getCell(skuCol).value ?? '').trim() || null : null;
            const rawPrice = priceCol ? row.getCell(priceCol).value : null;
            const unitPrice = rawPrice != null && rawPrice !== '' ? Number(rawPrice) : 0;

            if (!barcode) throw new Error('Código de barras vazio.');
            if (!name) throw new Error('Nome do produto vazio.');
            if (Number.isNaN(unitPrice) || unitPrice < 0) {
              throw new Error(`Preço inválido: "${rawPrice}".`);
            }

            // Upsert por código de barras dentro do tenant (Seção 5.4): uma
            // reimportação atualiza o produto existente em vez de duplicar.
            const existing = await manager.findOne(Product, {
              where: { companyId, barcode },
            });

            if (existing) {
              existing.name = name;
              existing.sku = sku;
              existing.unitPrice = unitPrice;
              await manager.save(existing);
            } else {
              const product = manager.create(Product, {
                companyId,
                barcode,
                name,
                sku,
                unitPrice,
                sourceColumnMapping: mapping as unknown as Record<string, string>,
              });
              await manager.save(product);
            }

            successCount++;
          } catch (rowError) {
            if (errorReport.length < MAX_ERROR_REPORT_ENTRIES) {
              errorReport.push({
                row: rowNumber,
                error: rowError instanceof Error ? rowError.message : 'Erro desconhecido.',
              });
            }
          }
        }

        importJob.status = ImportJobStatus.COMPLETED;
        importJob.totalRows = totalRows;
        importJob.successCount = successCount;
        importJob.errorCount = totalRows - successCount;
        importJob.errorReport = errorReport.length > 0 ? errorReport : null;
        importJob.completedAt = new Date();
        await manager.save(importJob);
      } catch (fatalError) {
        importJob.status = ImportJobStatus.FAILED;
        importJob.errorReport = [
          {
            row: 0,
            error: fatalError instanceof Error ? fatalError.message : 'Erro desconhecido ao processar a planilha.',
          },
        ];
        importJob.completedAt = new Date();
        await manager.save(importJob);
        this.logger.error(`Falha ao processar importação ${importJobId}`, fatalError as Error);
      }
    });
  }
}

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { StorageService } from '../uploads/storage.service';
import { ColumnMappingDto } from './dto/column-mapping.dto';
import { ImportJob, ImportJobStatus } from './import-job.entity';

export interface ProductImportJobData {
  importJobId: string;
  companyId: string;
  storageKey: string;
  mapping: ColumnMappingDto;
}

export const PRODUCTS_IMPORT_QUEUE = 'products-import';

@Injectable()
export class ImportsService {
  constructor(
    private readonly storageService: StorageService,
    @InjectQueue(PRODUCTS_IMPORT_QUEUE) private readonly importQueue: Queue<ProductImportJobData>,
  ) {}

  /**
   * Fluxo assíncrono descrito na Seção 5.2 do documento: salva o arquivo bruto
   * no object storage, cria o registro de acompanhamento e devolve o jobId
   * IMEDIATAMENTE — o processamento pesado acontece depois, em um worker
   * separado (ImportsProcessor), sem travar esta requisição HTTP.
   */
  async createImportJob(
    file: Express.Multer.File,
    mapping: ColumnMappingDto,
  ): Promise<{ jobId: string }> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const { key } = await this.storageService.uploadBuffer({
      companyId: companyId!,
      folder: 'imports',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });

    const importJob = manager.create(ImportJob, {
      companyId: companyId!,
      status: ImportJobStatus.PENDING,
      fileName: file.originalname,
      storageKey: key,
    });
    await manager.save(importJob);

    await this.importQueue.add('process-products-import', {
      importJobId: importJob.id,
      companyId: companyId!,
      storageKey: key,
      mapping,
    });

    return { jobId: importJob.id };
  }

  async findJob(id: string): Promise<ImportJob> {
    const manager = getTenantManager();
    const job = await manager.findOne(ImportJob, { where: { id } });
    if (!job) throw new NotFoundException('Importação não encontrada.');
    return job;
  }
}

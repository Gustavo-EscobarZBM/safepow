import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { StorageService } from '../uploads/storage.service';
import { IMPORTS_QUEUE, ImportQueueData } from './import-jobs.service';
import { ImportSimulator } from './import-simulator';

/** Worker da fila de importação 2.0 (SP3). A etapa 3.1.2 acrescenta "apply". */
@Processor(IMPORTS_QUEUE)
export class ImportsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsQueueProcessor.name);
  private readonly simulator: ImportSimulator;

  constructor(dataSource: DataSource, storage: StorageService) {
    super();
    this.simulator = new ImportSimulator(dataSource, storage);
  }

  async process(job: Job<ImportQueueData>): Promise<void> {
    switch (job.name) {
      case 'simulate':
        await this.simulator.run(job.data);
        return;
      default:
        this.logger.warn(`Mensagem desconhecida na fila ${IMPORTS_QUEUE}: ${job.name}`);
    }
  }
}

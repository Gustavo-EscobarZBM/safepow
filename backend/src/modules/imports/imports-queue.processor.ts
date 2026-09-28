import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { StorageService } from '../uploads/storage.service';
import { IMPORTS_QUEUE, ImportQueueData } from './import-jobs.service';
import { ImportApplier } from './import-applier';
import { ImportRollbacker } from './import-rollbacker';
import { ImportSimulator } from './import-simulator';

/** Worker da fila de importação 2.0 (SP3): simulação, gravação e reversão. */
@Processor(IMPORTS_QUEUE)
export class ImportsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsQueueProcessor.name);
  private readonly simulator: ImportSimulator;
  private readonly applier: ImportApplier;
  private readonly rollbacker: ImportRollbacker;

  constructor(
    dataSource: DataSource,
    storage: StorageService,
  ) {
    super();
    this.simulator = new ImportSimulator(dataSource, storage);
    this.applier = new ImportApplier(dataSource);
    this.rollbacker = new ImportRollbacker(dataSource);
  }

  async process(job: Job<ImportQueueData>): Promise<void> {
    switch (job.name) {
      case 'simulate': {
        await this.simulator.run(job.data);
        return;
      }
      case 'apply':
        await this.applier.run(job.data);
        return;
      case 'rollback':
        await this.rollbacker.run(job.data);
        return;
      default:
        this.logger.warn(`Mensagem desconhecida na fila ${IMPORTS_QUEUE}: ${job.name}`);
    }
  }
}

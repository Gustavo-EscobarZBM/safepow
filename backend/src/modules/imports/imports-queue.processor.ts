import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { normalizePolicies } from '../approvals/approval-policies';
import { StorageService } from '../uploads/storage.service';
import { getImportHandler } from './handlers';
import { ImportJob, ImportJobStatus } from './import-job.entity';
import { IMPORTS_QUEUE, ImportQueueData } from './import-jobs.service';
import { ImportApplier } from './import-applier';
import { ImportSimulator } from './import-simulator';

export const AUTO_APPLY_NEEDS_APPROVAL = 'Esta importação precisa de justificativa/aprovação. Use a nova tela de importação.';

/**
 * Importação com gravação automática (endpoint antigo da tela de produtos): terminada a simulação, grava direto se
 * nenhuma política de aprovação se aplica; senão deixa a mensagem para a tela. Devolve o applyRunId, ou null.
 */
async function prepareAutoApply(dataSource: DataSource, data: ImportQueueData): Promise<string | null> {
  return dataSource.transaction(async (m) => {
    await m.query(`SELECT set_config('app.current_company_id', $1, true)`, [data.companyId]);
    const job = await m.findOne(ImportJob, { where: { id: data.jobId }, lock: { mode: 'pessimistic_write' } });
    const options = job?.options;
    if (!job || job.status !== ImportJobStatus.SIMULATED || !options?.autoApply || options.runId !== data.runId || options.applyStartedAt) {
      return null;
    }
    const [company]: { approvalPolicies: unknown }[] = await m.query(`SELECT "approvalPolicies" FROM companies WHERE id = $1`, [
      data.companyId,
    ]);
    const policies = normalizePolicies(company?.approvalPolicies);
    const sensitive =
      policies.price_change.enabled &&
      (await getImportHandler(job.resource).countSensitivePriceChanges(
        m,
        job.id,
        policies.price_change.thresholdPercent,
        options.updateFields ?? [],
      )) > 0;
    if (sensitive) {
      await m.update(ImportJob, { id: job.id }, { lastError: AUTO_APPLY_NEEDS_APPROVAL });
      return null;
    }
    const applyRunId = randomUUID();
    await m.update(ImportJob, { id: job.id }, {
      status: ImportJobStatus.APPLYING,
      options: { ...options, applyRunId, applyStartedAt: new Date().toISOString() },
    });
    return applyRunId;
  });
}

/** Worker da fila de importação 2.0 (SP3): simulação e gravação. */
@Processor(IMPORTS_QUEUE)
export class ImportsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsQueueProcessor.name);
  private readonly simulator: ImportSimulator;
  private readonly applier: ImportApplier;

  constructor(
    private readonly dataSource: DataSource,
    storage: StorageService,
  ) {
    super();
    this.simulator = new ImportSimulator(dataSource, storage);
    this.applier = new ImportApplier(dataSource);
  }

  async process(job: Job<ImportQueueData>): Promise<void> {
    switch (job.name) {
      case 'simulate': {
        await this.simulator.run(job.data);
        const applyRunId = await prepareAutoApply(this.dataSource, job.data);
        if (applyRunId) await this.applier.run({ ...job.data, runId: applyRunId });
        return;
      }
      case 'apply':
        await this.applier.run(job.data);
        return;
      default:
        this.logger.warn(`Mensagem desconhecida na fila ${IMPORTS_QUEUE}: ${job.name}`);
    }
  }
}

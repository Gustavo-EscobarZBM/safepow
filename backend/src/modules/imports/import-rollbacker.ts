import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { recordAuditEvent } from '../audit/audit-events';
import { getImportHandler } from './handlers';
import { ImportJob, ImportJobStatus } from './import-job.entity';
import type { ImportQueueData } from './import-jobs.service';

const DEFAULT_BATCH_SIZE = 500;

/** Outra reversão assumiu (rollbackRunId/attemptId diferente) ou o job saiu de "rolling_back": parar sem gravar. */
class Superseded extends Error {}

interface RunRef {
  runId: string;
  attemptId?: string;
}

export interface RollbackerLimits {
  batchSize?: number;
  /** Só para testes: chamado antes de cada lote, fora da transação. */
  beforeBatch?: () => Promise<void>;
  /** Só para testes: chamado dentro da 1ª transação, depois de gravar o attemptId. */
  beforeStart?: () => Promise<void>;
}

/**
 * Worker da reversão (SP3, spec 2.6). Mesmo desenho da gravação: lotes de 500, cada um numa transação com o contexto
 * da empresa, quem liberou a reversão como ator, origem `import_rollback` no histórico de preço e auditoria em modo
 * resumo; cada transação trava o job e confere rollbackRunId + attemptId. Falha no meio: as linhas já revertidas ficam
 * marcadas, o job volta a `completed` com a mensagem e reverter de novo continua de onde parou.
 */
export class ImportRollbacker {
  private readonly logger = new Logger(ImportRollbacker.name);
  private readonly batchSize: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly limits: RollbackerLimits = {},
  ) {
    this.batchSize = limits.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async run(data: ImportQueueData): Promise<void> {
    const { jobId, companyId } = data;
    const job = await this.tx(companyId, null, (m) => m.findOne(ImportJob, { where: { id: jobId } }));
    if (!job || job.status !== ImportJobStatus.ROLLING_BACK || job.options?.rollbackRunId !== data.runId) return;

    const actor = job.options?.rollbackActorUserId ?? job.createdByUserId;
    const run: RunRef = { runId: data.runId, attemptId: randomUUID() };
    const handler = getImportHandler(job.resource);

    // A 1ª transação grava o attemptId; se ela falhar, o attemptId é desfeito junto e o catch confere só o runId.
    let attemptSaved = false;
    try {
      await this.tx(companyId, actor, async (m) => {
        await this.lockCurrent(m, jobId, { runId: run.runId });
        await m.query(`UPDATE import_jobs SET options = options || jsonb_build_object('attemptId', $2::text) WHERE id = $1`, [
          jobId,
          run.attemptId,
        ]);
        await this.limits.beforeStart?.();
      });
      attemptSaved = true;

      for (;;) {
        await this.limits.beforeBatch?.();
        const done = await this.tx(companyId, actor, async (m) => {
          await this.lockCurrent(m, jobId, run);
          const { restored, conflicts } = await handler.rollbackBatch(m, jobId, this.batchSize);
          return restored + conflicts;
        });
        if (done === 0) break;
      }

      await this.tx(companyId, actor, async (m) => {
        await this.lockCurrent(m, jobId, run);
        await this.finish(m, job, companyId);
      });
    } catch (error) {
      if (error instanceof Superseded) return;
      this.logger.error(`Falha na reversão da importação ${jobId}`, error as Error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao reverter a importação.';
      await this.tx(companyId, actor, async (m) => {
        await this.lockCurrent(m, jobId, attemptSaved ? run : { runId: run.runId });
        // Volta a "concluída" (não "falhou": falhou com applyStartedAt quer dizer "gravar de novo"); reverter continua.
        await m.query(
          `UPDATE import_jobs SET status = $2, "lastError" = $3,
                  options = options - 'rollbackRunId' - 'attemptId'
            WHERE id = $1`,
          [jobId, ImportJobStatus.COMPLETED, message],
        );
      }).catch((inner) => {
        if (!(inner instanceof Superseded)) throw inner;
      });
    }
  }

  private async finish(m: EntityManager, job: ImportJob, companyId: string): Promise<void> {
    const [counts]: { restored: number; conflicts: number }[] = await m.query(
      `SELECT count(*) FILTER (WHERE "rollbackResult" = 'restored')::int AS restored,
              count(*) FILTER (WHERE "rollbackResult" = 'conflict')::int AS conflicts
         FROM import_rows WHERE "jobId" = $1`,
      [job.id],
    );
    await m.query(
      `UPDATE import_jobs
          SET status = $2, "rolledBackAt" = now(), "lastError" = NULL,
              summary = summary || jsonb_build_object('rolledBackCount', $3::int, 'conflictCount', $4::int)
        WHERE id = $1`,
      [job.id, ImportJobStatus.ROLLED_BACK, counts.restored, counts.conflicts],
    );
    await recordAuditEvent(m, {
      companyId,
      entityType: 'import_job',
      entityId: job.id,
      entityLabel: job.fileName,
      action: 'rollback',
      summary: {
        status: 'rolled_back',
        restored: counts.restored,
        conflicts: counts.conflicts,
        changeRequestId: job.options?.rollbackRequestId ?? null,
      },
    });
  }

  /** Trava o job até o fim da transação e confirma que esta reversão é a vigente. */
  private async lockCurrent(m: EntityManager, jobId: string, run: RunRef): Promise<void> {
    const [row]: { status: string; runId: string | null; attemptId: string | null }[] = await m.query(
      `SELECT status, options->>'rollbackRunId' AS "runId", options->>'attemptId' AS "attemptId"
         FROM import_jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    if (!row || row.status !== ImportJobStatus.ROLLING_BACK || row.runId !== run.runId) throw new Superseded();
    if (run.attemptId && row.attemptId !== run.attemptId) throw new Superseded();
  }

  private tx<T>(companyId: string, actorUserId: string | null, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (m) => {
      await m.query(
        `SELECT set_config('app.current_company_id', $1, true), set_config('app.current_user_id', $2, true),
                set_config('app.change_source', 'import_rollback', true), set_config('app.audit_mode', 'summary', true),
                set_config('app.audit_source', 'import', true)`,
        [companyId, actorUserId ?? ''],
      );
      return fn(m);
    });
  }
}

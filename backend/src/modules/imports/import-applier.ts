import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { recordAuditEvent } from '../audit/audit-events';
import { AppliedRow } from './engine/types';
import { getImportHandler } from './handlers';
import { ImportJob, ImportJobStatus } from './import-job.entity';
import type { ImportQueueData } from './import-jobs.service';

const DEFAULT_BATCH_SIZE = 500;

/** A gravação foi substituída (outro applyRunId/attemptId) ou o job saiu de "applying": parar sem gravar mais. */
class Superseded extends Error {}
/** Condição que impede a gravação antes de começar (mensagem vai para lastError). */
class ApplyAborted extends Error {}

interface RunRef {
  runId: string;
  attemptId?: string;
}

export interface ApplierLimits {
  batchSize?: number;
  /** Só para testes: chamado antes de cada lote, fora da transação. */
  beforeBatch?: () => Promise<void>;
}

/**
 * Worker da gravação (SP3, spec 2.5). Cada lote de 500 linhas numa transação própria, com o contexto da empresa,
 * o autor da importação como ator (histórico de preço e auditoria), origem "import" e auditoria em modo resumo.
 * Cada transação trava o job e confere applyRunId + attemptId: mensagem velha ou reentregue não grava nada.
 * Falha no meio deixa os lotes anteriores gravados; "tentar de novo" continua das linhas sem appliedAt.
 */
export class ImportApplier {
  private readonly logger = new Logger(ImportApplier.name);
  private readonly batchSize: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly limits: ApplierLimits = {},
  ) {
    this.batchSize = limits.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async run(data: ImportQueueData): Promise<void> {
    const { jobId, companyId } = data;
    const job = await this.tx(companyId, null, (m) => m.findOne(ImportJob, { where: { id: jobId } }));
    if (!job || job.status !== ImportJobStatus.APPLYING || job.options?.applyRunId !== data.runId) return;

    const actor = job.createdByUserId;
    const run: RunRef = { runId: data.runId, attemptId: randomUUID() };
    const handler = getImportHandler(job.resource);
    const options = job.options!;
    const ctx = { mappedFields: Object.keys(job.mapping ?? {}), updateFields: options.updateFields ?? [] };

    try {
      await this.tx(companyId, actor, async (m) => {
        await this.lockCurrent(m, jobId, { runId: run.runId });
        await m.query(`UPDATE import_jobs SET options = options || jsonb_build_object('attemptId', $2::text) WHERE id = $1`, [
          jobId,
          run.attemptId,
        ]);
        if (options.archiveMissing && options.confirmArchiveCount !== undefined) {
          const { count } = await handler.countMissing(m, jobId);
          if (count > options.confirmArchiveCount) {
            throw new ApplyAborted(
              `O número de produtos ausentes mudou (era ${options.confirmArchiveCount}, agora ${count}). Simule de novo.`,
            );
          }
        }
      });

      for (;;) {
        await this.limits.beforeBatch?.();
        const applied = await this.tx(companyId, actor, async (m) => {
          await this.lockCurrent(m, jobId, run);
          const rows: { id: string; key: string; normalized: Record<string, unknown> }[] = await m.query(
            `SELECT id, key, normalized FROM import_rows
              WHERE "jobId" = $1 AND action IN ('create', 'update', 'reactivate', 'unchanged') AND "appliedAt" IS NULL
              ORDER BY "rowNumber", id
              LIMIT $2
              FOR UPDATE`,
            [jobId, this.batchSize],
          );
          if (rows.length === 0) return 0;
          const results = await handler.applyBatch(
            m,
            rows.map((r) => ({ rowId: r.id, key: r.key, values: r.normalized })),
            ctx,
          );
          await this.markApplied(m, results);
          await m.query(
            `UPDATE import_jobs
                SET summary = jsonb_set(summary, '{appliedCount}', to_jsonb(COALESCE((summary->>'appliedCount')::int, 0) + $2))
              WHERE id = $1`,
            [jobId, results.filter((r) => r.appliedAction !== 'error').length],
          );
          return rows.length;
        });
        if (applied === 0) break;
      }

      if (options.archiveMissing) {
        for (;;) {
          const archived = await this.tx(companyId, actor, async (m) => {
            await this.lockCurrent(m, jobId, run);
            const records = await handler.archiveMissingBatch(m, jobId, this.batchSize);
            if (records.length) {
              await m.query(
                `INSERT INTO import_rows ("companyId", "jobId", key, action, "productId", before, "appliedAction", "appliedUpdatedAt", "appliedAt")
                 SELECT $1, $2, v.key, 'archive', v.id, v.before, 'archive', v.updated, now()
                   FROM unnest($3::text[], $4::uuid[], $5::jsonb[], $6::timestamptz[]) AS v(key, id, before, updated)`,
                [
                  companyId,
                  jobId,
                  records.map((r) => r.key),
                  records.map((r) => r.entityId),
                  records.map((r) => JSON.stringify(r.before)),
                  records.map((r) => r.updatedAt),
                ],
              );
            }
            return records.length;
          });
          if (archived === 0) break;
        }
      }

      await this.tx(companyId, actor, async (m) => {
        await this.lockCurrent(m, jobId, run);
        await this.finish(m, job, companyId);
      });
    } catch (error) {
      if (error instanceof Superseded) return;
      if (!(error instanceof ApplyAborted)) this.logger.error(`Falha na gravação da importação ${jobId}`, error as Error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao gravar a importação.';
      await this.tx(companyId, actor, async (m) => {
        // ApplyAborted nasce na 1ª transação, que foi desfeita junto com o attemptId: confere só o applyRunId.
        await this.lockCurrent(m, jobId, error instanceof ApplyAborted ? { runId: run.runId } : run);
        await m.update(ImportJob, { id: jobId }, { status: ImportJobStatus.FAILED, lastError: message, completedAt: new Date() });
        if (error instanceof ApplyAborted) {
          // Nada foi gravado: sem applyStartedAt o job volta a aceitar "simular de novo", como a mensagem pede.
          await m.query(`UPDATE import_jobs SET options = options - 'applyStartedAt' - 'applyRunId' - 'attemptId' WHERE id = $1`, [jobId]);
        }
        await recordAuditEvent(m, {
          companyId,
          entityType: 'import_job',
          entityId: jobId,
          entityLabel: job.fileName,
          action: 'import',
          summary: { status: 'failed', error: message },
        });
      }).catch((inner) => {
        if (!(inner instanceof Superseded)) throw inner;
      });
    }
  }

  private async markApplied(m: EntityManager, results: AppliedRow[]): Promise<void> {
    await m.query(
      `UPDATE import_rows r
          SET "productId" = v.entity, "appliedAction" = v.action, before = v.before, "appliedUpdatedAt" = v.updated,
              "appliedAt" = now(), errors = CASE WHEN v.error IS NULL THEN r.errors ELSE array_append(r.errors, v.error) END
         FROM unnest($1::bigint[], $2::uuid[], $3::text[], $4::jsonb[], $5::timestamptz[], $6::text[])
              AS v(id, entity, action, before, updated, error)
        WHERE r.id = v.id`,
      [
        results.map((r) => r.rowId),
        results.map((r) => r.entityId),
        results.map((r) => r.appliedAction),
        results.map((r) => (r.before ? JSON.stringify(r.before) : null)),
        results.map((r) => r.updatedAt),
        results.map((r) => r.error ?? null),
      ],
    );
  }

  private async finish(m: EntityManager, job: ImportJob, companyId: string): Promise<void> {
    const rows: { action: string; n: number }[] = await m.query(
      `SELECT "appliedAction" AS action, count(*)::int AS n FROM import_rows
        WHERE "jobId" = $1 AND "appliedAt" IS NOT NULL GROUP BY 1`,
      [job.id],
    );
    const count = (action: string) => rows.find((r) => r.action === action)?.n ?? 0;
    const created = count('create');
    const updated = count('update');
    const reactivated = count('reactivate');
    const unchanged = count('unchanged');
    const archived = count('archive');
    const successCount = created + updated + reactivated + unchanged;
    const errors = (job.summary?.counts.error ?? 0) + count('error');
    await m.query(
      `UPDATE import_jobs
          SET status = $2, "appliedAt" = now(), "completedAt" = now(), "successCount" = $3, "errorCount" = $4, "lastError" = NULL,
              summary = jsonb_set(summary, '{appliedCount}', to_jsonb($3::int))
        WHERE id = $1`,
      [job.id, ImportJobStatus.COMPLETED, successCount, errors],
    );
    await recordAuditEvent(m, {
      companyId,
      entityType: 'import_job',
      entityId: job.id,
      entityLabel: job.fileName,
      action: 'import',
      summary: { status: 'completed', created, updated, reactivated, unchanged, archived, errors, changeRequestId: job.changeRequestId },
    });
  }

  /** Trava o job até o fim da transação e confirma que esta gravação é a vigente. */
  private async lockCurrent(m: EntityManager, jobId: string, run: RunRef): Promise<void> {
    const [row]: { status: string; runId: string | null; attemptId: string | null }[] = await m.query(
      `SELECT status, options->>'applyRunId' AS "runId", options->>'attemptId' AS "attemptId" FROM import_jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    if (!row || row.status !== ImportJobStatus.APPLYING || row.runId !== run.runId) throw new Superseded();
    if (run.attemptId && row.attemptId !== run.attemptId) throw new Superseded();
  }

  private tx<T>(companyId: string, actorUserId: string | null, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (m) => {
      await m.query(
        `SELECT set_config('app.current_company_id', $1, true), set_config('app.current_user_id', $2, true),
                set_config('app.change_source', 'import', true), set_config('app.audit_mode', 'summary', true),
                set_config('app.audit_source', 'import', true)`,
        [companyId, actorUserId ?? ''],
      );
      return fn(m);
    });
  }
}

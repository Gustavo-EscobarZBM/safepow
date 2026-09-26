import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { normalizePolicies } from '../approvals/approval-policies';
import { StorageService } from '../uploads/storage.service';
import { ImportFileError } from './engine/file-sniff';
import { buildImportReportCsv, ReportRow } from './engine/report-csv';
import { openTable, TableRow } from './engine/sheet-reader';
import { ImportFieldDef, ImportResourceHandler, RowAction } from './engine/types';
import { getImportHandler } from './handlers';
import { ImportJob, ImportJobStatus, ImportRowError, ImportSummary } from './import-job.entity';
import type { ImportQueueData } from './import-jobs.service';
import { ImportRow } from './import-row.entity';

const BLOCK_SIZE = 1_000;
const MAX_ERROR_REPORT_ENTRIES = 200;
const REPORT_PAGE = 5_000;
export const DEFAULT_MAX_IMPORT_ROWS = 200_000;

/** A simulação foi substituída por outra (novo runId) no meio do caminho: parar sem gravar mais nada. */
class Superseded extends Error {}

interface MappedColumn {
  def: ImportFieldDef;
  header: string;
  index: number;
}

const emptyCounts = (): Record<RowAction, number> => ({
  create: 0,
  update: 0,
  reactivate: 0,
  unchanged: 0,
  error: 0,
  duplicate: 0,
  archive: 0,
});

/**
 * Worker da simulação (SP3, spec 2.3): lê a planilha em streaming, normaliza, classifica cada linha contra o
 * catálogo e grava tudo em `import_rows` — sem tocar nos registros de verdade. Roda fora do HTTP, então cada
 * transação define `app.current_company_id` na mão; cada bloco relê o job com trava e confere o `runId`, para
 * que uma simulação substituída nunca misture linhas com a nova.
 */
export class ImportSimulator {
  private readonly logger = new Logger(ImportSimulator.name);
  private readonly maxRows: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    limits?: { maxRows: number },
  ) {
    this.maxRows = limits?.maxRows ?? DEFAULT_MAX_IMPORT_ROWS;
  }

  async run(data: ImportQueueData): Promise<void> {
    const { jobId, companyId, runId } = data;
    const job = await this.tx(companyId, (m) => m.findOne(ImportJob, { where: { id: jobId } }));
    if (!job || job.status !== ImportJobStatus.SIMULATING || job.options?.runId !== runId) return;

    try {
      await this.tx(companyId, async (m) => {
        await this.lockCurrent(m, jobId, runId);
        await m.delete(ImportRow, { jobId });
      });
      await this.simulate(job, companyId, runId);
    } catch (error) {
      if (error instanceof Superseded) return;
      this.logger.error(`Falha na simulação da importação ${jobId}`, error as Error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao ler a planilha.';
      await this.tx(companyId, async (m) => {
        await this.lockCurrent(m, jobId, runId);
        await m.update(ImportJob, { id: jobId }, { status: ImportJobStatus.FAILED, lastError: message, completedAt: new Date() });
      }).catch((inner) => {
        if (!(inner instanceof Superseded)) throw inner;
      });
    }
  }

  private async simulate(job: ImportJob, companyId: string, runId: string): Promise<void> {
    const handler = getImportHandler(job.resource);
    const mapping = job.mapping ?? {};
    const updateFields = job.options?.updateFields ?? [];
    const buffer = await this.storage.downloadBuffer(job.storageKey);
    const threshold = await this.tx(companyId, (m) => this.priceThreshold(m, companyId));

    const { headers, rows } = await openTable(buffer, { format: job.format ?? 'xlsx', sheetName: job.sheetName, delimiter: job.delimiter });
    const columns: MappedColumn[] = Object.entries(mapping).map(([field, header]) => {
      const index = headers.indexOf(header);
      if (index < 0) throw new ImportFileError('UNSUPPORTED_FILE', `A coluna "${header}" não existe na planilha.`);
      return { def: handler.fields.find((f) => f.key === field)!, header, index };
    });

    const summary: ImportSummary = {
      totalRows: 0,
      counts: emptyCounts(),
      warnings: {},
      missingCount: 0,
      sensitive: { priceChange: 0, archiveWithHistory: 0 },
    };
    const errorReport: ImportRowError[] = [];
    const seen = new Map<string, { rowNumber: number; signature: string }>();
    const ctx = { mappedFields: Object.keys(mapping), updateFields, priceThresholdPercent: threshold };

    let block: TableRow[] = [];
    const flush = async () => {
      const pending = block;
      block = [];
      await this.tx(companyId, async (m) => {
        await this.lockCurrent(m, job.id, runId);
        const prepared = pending.map((row) => this.prepare(row, columns, handler, seen));
        const keys = prepared.filter((p) => p.action === null).map((p) => p.key!);
        const existing = await handler.loadExisting(m, keys);
        const entities = prepared.map((p) => {
          let action: RowAction = p.action ?? 'unchanged';
          let diff: ImportRow['diff'] = null;
          const warnings = [...p.warnings];
          if (p.action === null) {
            const plan = handler.plan(p.values, existing.get(p.key!), ctx);
            action = plan.action;
            diff = plan.diff;
            warnings.push(...plan.warnings);
            if (plan.sensitivePrice) summary.sensitive.priceChange++;
          }
          summary.counts[action]++;
          for (const code of warnings) summary.warnings[code] = (summary.warnings[code] ?? 0) + 1;
          if (action === 'error' && errorReport.length < MAX_ERROR_REPORT_ENTRIES) {
            errorReport.push({ row: p.rowNumber, error: p.errors.join(' | ') });
          }
          return m.create(ImportRow, {
            companyId,
            jobId: job.id,
            rowNumber: p.rowNumber,
            raw: p.raw,
            normalized: p.values,
            key: p.key,
            action,
            diff,
            warnings,
            errors: p.errors,
          });
        });
        if (entities.length) await m.createQueryBuilder().insert().into(ImportRow).values(entities as QueryDeepPartialEntity<ImportRow>[]).execute();
      });
    };

    for await (const row of rows) {
      summary.totalRows++;
      if (summary.totalRows > this.maxRows) {
        throw new ImportFileError('TOO_MANY_ROWS', `A planilha tem mais de ${this.maxRows.toLocaleString('pt-BR')} linhas.`);
      }
      block.push(row);
      if (block.length >= BLOCK_SIZE) await flush();
    }
    if (block.length) await flush();

    await this.tx(companyId, async (m) => {
      await this.lockCurrent(m, job.id, runId);
      const missing = await handler.countMissing(m, job.id);
      summary.missingCount = missing.count;
      summary.sensitive.archiveWithHistory = missing.withHistory;
    });

    // Na ordem da planilha (o jsonb do mapeamento não guarda a ordem das chaves).
    const reportHeaders = [...columns].sort((a, b) => a.index - b.index).map((c) => c.header);
    const reportCsv = await this.tx(companyId, (m) => this.buildReport(m, job.id, reportHeaders));
    const { key: errorReportKey } = await this.storage.uploadBuffer({
      companyId,
      folder: 'imports',
      buffer: Buffer.from(reportCsv, 'utf8'),
      contentType: 'text/csv',
      originalName: 'relatorio.csv',
    });

    await this.tx(companyId, async (m) => {
      await this.lockCurrent(m, job.id, runId);
      await m.update(ImportJob, { id: job.id }, {
        status: ImportJobStatus.SIMULATED,
        simulatedAt: new Date(),
        summary,
        errorReport: errorReport.length ? errorReport : null,
        errorReportKey,
        totalRows: summary.totalRows,
        errorCount: summary.counts.error,
        successCount: 0,
        lastError: null,
      });
    });
  }

  /** Normaliza a linha e resolve repetição dentro do arquivo. `action === null` ⇒ ainda falta o plano do handler. */
  private prepare(
    row: TableRow,
    columns: MappedColumn[],
    handler: ImportResourceHandler,
    seen: Map<string, { rowNumber: number; signature: string }>,
  ): {
    rowNumber: number;
    raw: Record<string, string | null>;
    values: Record<string, unknown>;
    key: string | null;
    errors: string[];
    warnings: string[];
    action: RowAction | null;
  } {
    const raw: Record<string, string | null> = {};
    const values: Record<string, unknown> = {};
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const column of columns) {
      const text = row.cells[column.index] ?? null;
      raw[column.header] = text;
      const cellError = row.cellErrors[column.index];
      if (cellError) {
        errors.push(`${column.def.label}: ${cellError}`);
        continue;
      }
      const result = column.def.normalize(text);
      values[column.def.key] = result.value;
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const keyValue = values[handler.keyField];
    const key = typeof keyValue === 'string' && keyValue ? keyValue : null;
    const base = { rowNumber: row.rowNumber, raw, values, key, errors, warnings };
    if (errors.length || !key) return { ...base, action: 'error' };

    const signature = JSON.stringify(values);
    const first = seen.get(key);
    if (!first) {
      seen.set(key, { rowNumber: row.rowNumber, signature });
      return { ...base, action: null };
    }
    if (first.signature === signature) return { ...base, warnings: [...warnings, 'DUPLICATE_IDENTICAL'], action: 'duplicate' };
    return { ...base, errors: [`Código repetido na linha ${first.rowNumber} com dados diferentes.`], action: 'error' };
  }

  private async buildReport(m: EntityManager, jobId: string, headers: string[]): Promise<string> {
    const rows: ReportRow[] = [];
    let lastId = '0';
    for (;;) {
      const page: (ReportRow & { id: string; normalized: Record<string, unknown> | null })[] = await m.query(
        `SELECT id, "rowNumber", key, action, errors, warnings, raw, normalized
           FROM import_rows
          WHERE "jobId" = $1 AND (cardinality(errors) > 0 OR cardinality(warnings) > 0) AND id > $2
          ORDER BY id
          LIMIT ${REPORT_PAGE}`,
        [jobId, lastId],
      );
      for (const row of page) rows.push({ ...row, name: (row.normalized?.name as string | undefined) ?? null });
      if (page.length < REPORT_PAGE) break;
      lastId = page[page.length - 1].id;
    }
    rows.sort((a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0));
    return buildImportReportCsv(headers, rows);
  }

  private async priceThreshold(m: EntityManager, companyId: string): Promise<number | null> {
    const [row]: { approvalPolicies: unknown }[] = await m.query(`SELECT "approvalPolicies" FROM companies WHERE id = $1`, [companyId]);
    const policies = normalizePolicies(row?.approvalPolicies);
    return policies.price_change.enabled ? policies.price_change.thresholdPercent : null;
  }

  /** Trava o job até o fim da transação e confirma que esta execução ainda é a vigente. */
  private async lockCurrent(m: EntityManager, jobId: string, runId: string): Promise<void> {
    const [row]: { status: string; runId: string | null }[] = await m.query(
      `SELECT status, options->>'runId' AS "runId" FROM import_jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    if (!row || row.status !== ImportJobStatus.SIMULATING || row.runId !== runId) throw new Superseded();
  }

  private tx<T>(companyId: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]);
      return fn(m);
    });
  }
}

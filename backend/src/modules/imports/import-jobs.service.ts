import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { afterCommit, getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { StorageService } from '../uploads/storage.service';
import { assertSafeZip, decodeCsv, detectDelimiter, detectFormat, ImportFileError } from './engine/file-sniff';
import { headerFingerprint, normalizeHeader, suggestMapping } from './engine/mapping';
import { listSheets, peekTable, TableSource } from './engine/sheet-reader';
import { ImportResourceHandler, MissingPage } from './engine/types';
import { ListImportRowsDto, PageQueryDto } from './dto/list-import-rows.dto';
import { SimulateImportDto } from './dto/simulate-import.dto';
import { ApplyImportDto } from './dto/apply-import.dto';
import { ColumnMappingDto } from './dto/column-mapping.dto';
import { applyApprovalGate, loadCompanyPolicies } from '../approvals/approval-gate';
import { ImportRow } from './import-row.entity';
import { getImportHandler } from './handlers';
import { ImportJob, ImportJobStatus } from './import-job.entity';
import { assertKnownFields, ImportMappingsService, mappingInvalid } from './import-mappings.service';

export const IMPORTS_QUEUE = 'imports';

const PURGE_ROWS_AFTER_DAYS = 30;
/** Gravação sem progresso há mais que isto pode ser tentada de novo (o novo applyRunId invalida a mensagem velha). */
const STUCK_APPLY_MS = 5 * 60 * 1000;
const ABANDON_AFTER_DAYS = 7;

/** Linha de exemplo do modelo (a coluna do código vai como texto para o Excel não comer zeros à esquerda). */
const TEMPLATE_EXAMPLE: Record<string, string | number> = {
  barcode: '7891234567895',
  name: 'Arroz tipo 1 5kg',
  sku: 'ARZ-5KG',
  unitPrice: 25.9,
  costPrice: 18.4,
};

const REQUEST_CLOSED_MESSAGE = 'Pedido de aprovação recusado, cancelado ou vencido.';

/** Acima desta fatia do catálogo, "arquivar ausentes" exige digitar o número (spec 2.4). */
const STRONG_CONFIRMATION_PERCENT = 20;

/** O que o pedido de aprovação guarda para detectar que o job mudou (re-simulado) antes da decisão. */
export function approvalSnapshotOf(job: ImportJob, status: ImportJobStatus = job.status): Record<string, unknown> {
  return { jobId: job.id, simulatedAt: job.simulatedAt ? new Date(job.simulatedAt).toISOString() : null, status };
}

export interface ImportQueueData {
  jobId: string;
  companyId: string;
  runId: string;
}

export type ImportRowView = Pick<ImportRow, 'rowNumber' | 'key' | 'action' | 'normalized' | 'diff' | 'warnings' | 'errors' | 'raw'>;

export interface PreviewResult {
  headers: string[];
  sample: (string | null)[][];
  suggestedMapping: Record<string, string>;
  matchedMapping: { id: string; name: string } | null;
}

export interface UploadResult extends PreviewResult {
  job: ImportJob;
  sheets: string[];
  duplicateOf: { jobId: string; fileName: string; appliedAt: string | null; createdByName: string | null } | null;
  fields: { key: string; label: string; required: boolean; updatable: boolean }[];
}

/** ImportFileError (motor) ⇒ 400 com errorCode. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof ImportFileError) {
    return new BadRequestException({ statusCode: 400, errorCode: error.errorCode, message: error.message });
  }
  return error;
}

export function invalidState(message = 'Esta importação não pode mais ser alterada.'): ConflictException {
  return new ConflictException({ statusCode: 409, errorCode: 'INVALID_STATE', message });
}

/** Assistente de importação 2.0 (SP3, spec 2.1–2.3 e 3): upload, prévia, simulação e consultas. */
@Injectable()
export class ImportJobsService {
  constructor(
    private readonly storage: StorageService,
    private readonly mappings: ImportMappingsService,
    @InjectQueue(IMPORTS_QUEUE) private readonly queue: Queue<ImportQueueData>,
  ) {}

  /** Histórico de importações da empresa (spec 3), mais novas primeiro. Também roda a limpeza preguiçosa. */
  async list(query: { resource?: string; page?: number; limit?: number }): Promise<{
    items: (ImportJob & { createdByName: string | null })[];
    total: number;
  }> {
    await this.purgeExpired();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = getTenantManager()
      .createQueryBuilder(ImportJob, 'j')
      .leftJoin('users', 'u', 'u.id = j."createdByUserId"')
      .addSelect('u.name', 'createdByName')
      .where('j.resource = :resource', { resource: query.resource ?? 'products' })
      .orderBy('j.createdAt', 'DESC')
      .addOrderBy('j.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);
    const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
    const items = entities.map((job, i) => Object.assign(job, { createdByName: (raw[i]?.createdByName as string | null) ?? null }));
    for (const job of items) await this.reconcileApproval(job);
    return { items, total };
  }

  /**
   * Limpeza preguiçosa da empresa atual (spec 1.5, feita no upload e na listagem em vez de um job diário — um job
   * sem empresa não enxergaria nada com a RLS forçada): linhas de preparação de importações com mais de 30 dias
   * (fim da janela de reversão) e importações paradas há mais de 7 dias sem confirmação.
   */
  async purgeExpired(): Promise<void> {
    const manager = getTenantManager();
    const old = `COALESCE("appliedAt", "createdAt") < now() - interval '${PURGE_ROWS_AFTER_DAYS} days'`;
    // Gravação que falhou e ficou esquecida deixa de poder ser retomada antes de perder as linhas.
    await manager.query(
      `UPDATE import_jobs SET status = 'cancelled', "completedAt" = now(),
              "lastError" = COALESCE("lastError", 'Importação abandonada depois de falhar.')
        WHERE status = 'failed' AND ${old}`,
    );
    // Só jobs terminais perdem as linhas de preparação (nunca um em andamento).
    await manager.query(
      `DELETE FROM import_rows r USING import_jobs j
        WHERE r."jobId" = j.id AND j.status IN ('completed', 'cancelled', 'rolled_back')
          AND COALESCE(j."appliedAt", j."createdAt") < now() - interval '${PURGE_ROWS_AFTER_DAYS} days'`,
    );
    await manager.query(
      `UPDATE import_jobs SET summary = COALESCE(summary, '{}'::jsonb) || '{"rowsPurged": true}'::jsonb
        WHERE status IN ('completed', 'cancelled', 'rolled_back') AND ${old}
          AND COALESCE(summary->>'rowsPurged', 'false') <> 'true'`,
    );
    await manager.query(
      `UPDATE import_jobs SET status = 'cancelled', "completedAt" = now(),
              "lastError" = 'Importação abandonada: mais de ${ABANDON_AFTER_DAYS} dias sem confirmação.'
        WHERE status IN ('uploaded', 'simulated') AND "createdAt" < now() - interval '${ABANDON_AFTER_DAYS} days'`,
    );
  }

  /** Planilha modelo (spec 3): cabeçalhos canônicos do handler, coluna da chave em formato texto e um exemplo. */
  async template(resource: string): Promise<Buffer> {
    const handler = getImportHandler(resource);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Importação');
    const keyIndex = handler.fields.findIndex((f) => f.key === handler.keyField) + 1;
    sheet.getColumn(keyIndex).numFmt = '@';
    sheet.addRow(handler.fields.map((f) => f.label));
    sheet.getRow(1).font = { bold: true };
    sheet.addRow(handler.fields.map((f) => TEMPLATE_EXAMPLE[f.key] ?? null));
    handler.fields.forEach((_, i) => (sheet.getColumn(i + 1).width = 22));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Endpoint antigo da tela de produtos: sobe, simula e grava direto (autoApply) com o mapeamento digitado. */
  async legacyImport(file: Express.Multer.File | undefined, legacy: ColumnMappingDto): Promise<{ jobId: string }> {
    const { job } = await this.upload(file, 'products');
    const mapping: Record<string, string> = { barcode: legacy.barcodeColumn, name: legacy.nameColumn };
    if (legacy.skuColumn) mapping.sku = legacy.skuColumn;
    if (legacy.unitPriceColumn) mapping.unitPrice = legacy.unitPriceColumn;
    const updateFields = Object.keys(mapping).filter((field) => field !== 'barcode');
    await this.simulate(job.id, { mapping, updateFields }, { autoApply: true });
    return { jobId: job.id };
  }

  /** Status no formato antigo (a tela antiga só entende processing/completed/failed). */
  async legacyStatus(id: string) {
    const job = await this.findOne(id);
    const running = [ImportJobStatus.UPLOADED, ImportJobStatus.SIMULATING, ImportJobStatus.APPLYING];
    const status = job.status === ImportJobStatus.COMPLETED ? 'completed' : running.includes(job.status) ? 'processing' : 'failed';
    const autoWaiting = job.status === ImportJobStatus.SIMULATED && job.options?.autoApply && !job.lastError;
    return {
      id: job.id,
      status: autoWaiting ? 'processing' : status,
      fileName: job.fileName,
      totalRows: job.totalRows,
      successCount: job.successCount,
      errorCount: job.errorCount,
      errorReport:
        status === 'failed' && !autoWaiting && !job.errorReport?.length
          ? [{ row: 0, error: job.lastError ?? 'Importação não concluída.' }]
          : job.errorReport,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }

  async upload(file: Express.Multer.File | undefined, resource: string): Promise<UploadResult> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado (campo "file").');
    const handler = getImportHandler(resource);
    const buffer = file.buffer;

    let format: 'xlsx' | 'csv';
    let sheets: string[] = [];
    let encoding: string | null = null;
    let delimiter: string | null = null;
    let preview: PreviewResult;
    try {
      format = detectFormat(buffer);
      if (format === 'xlsx') {
        assertSafeZip(buffer);
        sheets = await listSheets(buffer);
      } else {
        const decoded = decodeCsv(buffer);
        encoding = decoded.encoding;
        delimiter = detectDelimiter(decoded.text.split(/\r?\n/, 1)[0] ?? '');
      }
      preview = await this.previewOf(handler, buffer, { format, sheetName: sheets[0] ?? null, delimiter });
    } catch (error) {
      throw toHttpError(error);
    }

    const { companyId, userId } = getTenantContext();
    const manager = getTenantManager();
    await this.purgeExpired();
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const { key } = await this.storage.uploadBuffer({
      companyId: companyId!,
      folder: 'imports',
      buffer,
      contentType: file.mimetype || 'application/octet-stream',
      originalName: file.originalname,
    });
    const job = await manager.save(
      manager.create(ImportJob, {
        companyId: companyId!,
        status: ImportJobStatus.UPLOADED,
        resource: handler.resource,
        fileName: file.originalname,
        storageKey: key,
        fileHash,
        format,
        encoding,
        delimiter,
        sheetName: sheets[0] ?? null,
        sheets: format === 'xlsx' ? sheets : null,
        headers: preview.headers,
        createdByUserId: userId || null,
      }),
    );

    return {
      job,
      sheets,
      ...preview,
      duplicateOf: await this.findDuplicate(job),
      fields: handler.fields.map(({ key: fieldKey, label, required, updatable }) => ({ key: fieldKey, label, required, updatable })),
    };
  }

  async preview(id: string, sheetName: string): Promise<PreviewResult> {
    const job = await this.findOne(id);
    this.assertEditable(job);
    const buffer = await this.storage.downloadBuffer(job.storageKey);
    let preview: PreviewResult;
    try {
      preview = await this.previewOf(getImportHandler(job.resource), buffer, {
        format: job.format ?? 'xlsx',
        sheetName: job.format === 'csv' ? null : sheetName,
        delimiter: job.delimiter,
      });
    } catch (error) {
      throw toHttpError(error);
    }
    if (job.format !== 'csv') job.sheetName = sheetName;
    job.headers = preview.headers;
    await getTenantManager().save(job);
    return preview;
  }

  /** Valida o mapeamento e enfileira a simulação (só depois do commit — spec 2.4, "enfileirar só depois do commit"). */
  async simulate(id: string, dto: SimulateImportDto, extra: { autoApply?: boolean } = {}): Promise<ImportJob> {
    const job = await this.findOne(id);
    this.assertEditable(job, true);
    const handler = getImportHandler(job.resource);
    this.validateMapping(handler, dto);

    const sheetName = job.format === 'csv' ? null : (dto.sheetName ?? job.sheetName);
    let headers = job.headers ?? [];
    if (sheetName !== job.sheetName || !job.headers) {
      try {
        headers = (await peekTable(await this.storage.downloadBuffer(job.storageKey), {
          format: job.format ?? 'xlsx',
          sheetName,
          delimiter: job.delimiter,
        }, 0)).headers;
      } catch (error) {
        throw toHttpError(error);
      }
    }
    for (const header of Object.values(dto.mapping)) {
      if (!headers.includes(header)) throw mappingInvalid(`A coluna "${header}" não existe na planilha.`);
    }

    if (dto.saveMappingAs) {
      await this.mappings.save({ resource: job.resource, name: dto.saveMappingAs, mapping: dto.mapping, headers });
    }

    const { companyId } = getTenantContext();
    const runId = randomUUID();
    Object.assign(job, {
      sheetName,
      headers,
      mapping: dto.mapping,
      options: { updateFields: dto.updateFields, runId, ...extra },
      status: ImportJobStatus.SIMULATING,
      summary: null,
      errorReport: null,
      errorReportKey: null,
      simulatedAt: null,
      lastError: null,
      totalRows: null,
      errorCount: 0,
    });
    await getTenantManager().save(job);
    afterCommit(async () => {
      await this.queue.add('simulate', { jobId: job.id, companyId: companyId!, runId }, { removeOnComplete: 1000, removeOnFail: 1000 });
    });
    return job;
  }

  async listRows(id: string, query: ListImportRowsDto): Promise<{ items: ImportRowView[]; total: number }> {
    await this.findOne(id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const qb = getTenantManager()
      .createQueryBuilder(ImportRow, 'r')
      .select(['r.rowNumber', 'r.key', 'r.action', 'r.normalized', 'r.diff', 'r.warnings', 'r.errors', 'r.raw'])
      .where('r.jobId = :id', { id });
    if (query.action === 'warnings') qb.andWhere('cardinality(r.warnings) > 0');
    else if (query.action) qb.andWhere('r.action = :action', { action: query.action });
    const [items, total] = await qb
      .orderBy('r.rowNumber', 'ASC', 'NULLS LAST')
      .addOrderBy('r.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items, total };
  }

  async listMissing(id: string, query: PageQueryDto): Promise<MissingPage> {
    const job = await this.findOne(id);
    if (!job.simulatedAt) throw invalidState('Simule a importação primeiro.');
    return getImportHandler(job.resource).listMissing(getTenantManager(), id, query.page ?? 1, query.limit ?? 50);
  }

  async reportCsv(id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const job = await this.findOne(id);
    if (!job.errorReportKey) throw new NotFoundException('Relatório ainda não disponível.');
    const base = job.fileName.replace(/\.[^.]+$/, '');
    return { buffer: await this.storage.downloadBuffer(job.errorReportKey), fileName: `relatorio-${base}.csv` };
  }

  private validateMapping(handler: ImportResourceHandler, dto: SimulateImportDto): void {
    assertKnownFields(handler, dto.mapping);
    const required = handler.fields.filter((f) => f.required);
    if (required.some((f) => !dto.mapping[f.key])) {
      throw mappingInvalid(`Mapeie as colunas obrigatórias: ${required.map((f) => f.label).join(' e ')}.`);
    }
    const used = new Set<string>();
    for (const header of Object.values(dto.mapping)) {
      if (used.has(header)) throw mappingInvalid(`A coluna "${header}" foi usada em mais de um campo.`);
      used.add(header);
    }
    for (const field of dto.updateFields) {
      const def = handler.fields.find((f) => f.key === field);
      if (def && !def.updatable) throw mappingInvalid(`O campo "${field}" não pode ser atualizado.`);
      if (!dto.mapping[field]) throw mappingInvalid(`O campo "${field}" não está mapeado.`);
    }
  }

  /**
   * Confirmação (spec 2.4): trava por empresa, confirmação forte de "arquivar ausentes", políticas de aprovação do
   * SP2 (a importação inteira vira um pedido) e, se nada impedir, começa a gravação.
   */
  async apply(id: string, dto: ApplyImportDto): Promise<{ job: ImportJob } | { status: 'pending'; changeRequestId: string; job: ImportJob }> {
    const { userId } = getTenantContext();
    const manager = getTenantManager();
    const job = await this.lockForTransition(id);
    if (job.status !== ImportJobStatus.SIMULATED) throw invalidState('Simule a importação antes de confirmar.');
    await this.assertNoOtherActive(job.id);

    const handler = getImportHandler(job.resource);
    const archiveMissing = !!dto.archiveMissing;
    let confirmArchiveCount: number | undefined;
    let archiveWithHistory = 0;
    if (archiveMissing) {
      const missing = await handler.countMissing(manager, job.id);
      archiveWithHistory = missing.withHistory;
      const active = await handler.countActive(manager);
      if (missing.count * 100 > STRONG_CONFIRMATION_PERCENT * active) {
        if (dto.confirmArchiveCount !== missing.count) {
          throw new ConflictException({
            statusCode: 409,
            errorCode: 'ARCHIVE_CONFIRMATION_REQUIRED',
            message: `Arquivar ${missing.count} registros ausentes (mais de ${STRONG_CONFIRMATION_PERCENT}% do catálogo) exige confirmação: digite o número ${missing.count}.`,
            missingCount: missing.count,
          });
        }
        confirmArchiveCount = missing.count;
      }
    }
    job.options = { ...job.options!, archiveMissing, confirmArchiveCount };

    // Recontado agora (e não o da simulação): a política pode ter sido ligada ou mudado de limite depois.
    const policies = await loadCompanyPolicies();
    const priceSensitive =
      policies.price_change.enabled &&
      (await handler.countSensitivePriceChanges(manager, job.id, policies.price_change.thresholdPercent, job.options?.updateFields ?? [])) > 0;
    const archiveSensitive = policies.archive_with_history.enabled && archiveMissing && archiveWithHistory > 0;
    if (priceSensitive || archiveSensitive) {
      const pending = await applyApprovalGate({
        policy: priceSensitive ? 'price_change' : 'archive_with_history',
        entityType: 'import_job',
        entityId: job.id,
        entityLabel: job.fileName,
        operation: 'import',
        payload: { archiveMissing, confirmArchiveCount: confirmArchiveCount ?? null },
        snapshot: approvalSnapshotOf(job, ImportJobStatus.PENDING_APPROVAL),
        justification: dto.justification,
      });
      if (pending) {
        job.status = ImportJobStatus.PENDING_APPROVAL;
        job.changeRequestId = pending.changeRequestId;
        await manager.save(job);
        return { status: 'pending', changeRequestId: pending.changeRequestId, job };
      }
    }

    await this.startApply(job, userId || null);
    return { job };
  }

  /** Começa (ou recomeça) a gravação: status applying, novo applyRunId e mensagem na fila depois do commit. */
  async startApply(job: ImportJob, actorUserId: string | null): Promise<void> {
    const runId = randomUUID();
    job.status = ImportJobStatus.APPLYING;
    job.lastError = null;
    job.options = {
      ...job.options!,
      applyRunId: runId,
      applyStartedAt: job.options?.applyStartedAt ?? new Date().toISOString(),
      applyRequestedAt: new Date().toISOString(),
      ...(actorUserId ? { actorUserId } : {}),
    };
    await getTenantManager().save(job);
    const companyId = job.companyId;
    afterCommit(async () => {
      await this.queue.add('apply', { jobId: job.id, companyId, runId }, { removeOnComplete: 1000, removeOnFail: 1000 });
    });
  }

  async retry(id: string): Promise<ImportJob> {
    const { userId } = getTenantContext();
    const job = await this.lockForTransition(id);
    if (job.summary?.rowsPurged) {
      // Sem as linhas de preparação, "arquivar ausentes" veria o catálogo inteiro como ausente.
      throw invalidState('Esta importação é antiga demais para continuar. Importe a planilha de novo.');
    }
    const requestedAt = Date.parse(job.options?.applyRequestedAt ?? job.options?.applyStartedAt ?? '');
    const stuck = job.status === ImportJobStatus.APPLYING && requestedAt < Date.now() - STUCK_APPLY_MS;
    if (!(job.status === ImportJobStatus.FAILED && job.options?.applyStartedAt) && !stuck) {
      throw invalidState('Só dá para tentar de novo uma gravação que falhou ou está parada.');
    }
    await this.assertNoOtherActive(job.id);
    await this.startApply(job, userId || null);
    return job;
  }

  async cancel(id: string): Promise<ImportJob> {
    const job = await this.lockForTransition(id);
    const cancellable = [ImportJobStatus.UPLOADED, ImportJobStatus.SIMULATED, ImportJobStatus.FAILED, ImportJobStatus.PENDING_APPROVAL];
    if (!cancellable.includes(job.status)) throw invalidState('Esta importação não pode mais ser cancelada.');
    const manager = getTenantManager();
    if (job.status === ImportJobStatus.PENDING_APPROVAL && job.changeRequestId) {
      await manager.query(
        `UPDATE change_requests SET status = 'cancelled', "decidedAt" = now(), "decisionNote" = 'Importação cancelada.'
          WHERE id = $1 AND status = 'pending'`,
        [job.changeRequestId],
      );
    }
    job.status = ImportJobStatus.CANCELLED;
    job.completedAt = new Date();
    return manager.save(job);
  }

  /** Serializa as transições da empresa (duas confirmações ao mesmo tempo viram fila) e trava o job. */
  private async lockForTransition(id: string): Promise<ImportJob> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('imports:' || $1))`, [companyId]);
    const job = await manager.findOne(ImportJob, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!job) throw new NotFoundException('Importação não encontrada.');
    return job;
  }

  private async assertNoOtherActive(jobId: string): Promise<void> {
    // Pedido vencido que ninguém abriu não pode travar a empresa: reconcilia antes de checar.
    const waiting = await getTenantManager().find(ImportJob, { where: { status: ImportJobStatus.PENDING_APPROVAL } });
    for (const other of waiting) if (other.id !== jobId) await this.reconcileApproval(other);
    const rows = await getTenantManager().query(
      `SELECT 1 FROM import_jobs WHERE id <> $1 AND status IN ('simulating', 'applying', 'pending_approval', 'rolling_back') LIMIT 1`,
      [jobId],
    );
    if (rows.length) {
      throw new ConflictException({
        statusCode: 409,
        errorCode: 'IMPORT_IN_PROGRESS',
        message: 'Já existe uma importação em andamento. Aguarde terminar ou cancele-a.',
      });
    }
  }

  async findOne(id: string): Promise<ImportJob> {
    const job = await getTenantManager().findOne(ImportJob, { where: { id } });
    if (!job) throw new NotFoundException('Importação não encontrada.');
    await this.reconcileApproval(job);
    return job;
  }

  /** Estado do job para o pedido de aprovação (trava o job até o fim da decisão). */
  async approvalSnapshot(jobId: string): Promise<Record<string, unknown> | null> {
    const job = await getTenantManager().findOne(ImportJob, { where: { id: jobId }, lock: { mode: 'pessimistic_write' } });
    return job ? approvalSnapshotOf(job) : null;
  }

  /** Aprovação do pedido (SP2): a gravação começa com quem aprovou como liberador. */
  async startApprovedApply(jobId: string, approverUserId: string | null): Promise<void> {
    const job = await getTenantManager().findOne(ImportJob, { where: { id: jobId }, lock: { mode: 'pessimistic_write' } });
    if (!job || job.status !== ImportJobStatus.PENDING_APPROVAL) throw invalidState('A importação não está aguardando aprovação.');
    await this.startApply(job, approverUserId);
  }

  /** Pedido recusado, cancelado ou vencido: a importação que esperava por ele é cancelada. */
  async onRequestClosed(jobId: string): Promise<void> {
    await getTenantManager().query(
      `UPDATE import_jobs SET status = 'cancelled', "lastError" = $2, "completedAt" = now()
        WHERE id = $1 AND status = 'pending_approval'`,
      [jobId, REQUEST_CLOSED_MESSAGE],
    );
  }

  /** O SP2 expira pedidos de forma preguiçosa; aqui a importação acompanha ao ser consultada. */
  private async reconcileApproval(job: ImportJob): Promise<void> {
    if (job.status !== ImportJobStatus.PENDING_APPROVAL || !job.changeRequestId) return;
    const manager = getTenantManager();
    const [request]: { status: string; overdue: boolean }[] = await manager.query(
      `SELECT status, "expiresAt" < now() AS overdue FROM change_requests WHERE id = $1`,
      [job.changeRequestId],
    );
    if (request && request.status === 'pending' && !request.overdue) return;
    if (request?.status === 'pending') {
      await manager.query(
        `UPDATE change_requests SET status = 'expired', "decidedAt" = now(), "decisionNote" = 'Prazo de 7 dias vencido.'
          WHERE id = $1 AND status = 'pending'`,
        [job.changeRequestId],
      );
    }
    await this.onRequestClosed(job.id);
    job.status = ImportJobStatus.CANCELLED;
    job.lastError = REQUEST_CLOSED_MESSAGE;
  }

  /** Antes da gravação dá para trocar aba/colunas e simular de novo; depois, não. */
  protected assertEditable(job: ImportJob, allowSimulating = false): void {
    const editable = [ImportJobStatus.UPLOADED, ImportJobStatus.SIMULATED, ImportJobStatus.FAILED];
    if (allowSimulating) editable.push(ImportJobStatus.SIMULATING);
    if (!editable.includes(job.status) || job.appliedAt || job.options?.applyStartedAt) throw invalidState();
  }

  private async previewOf(handler: ImportResourceHandler, buffer: Buffer, source: TableSource): Promise<PreviewResult> {
    const { headers, sample } = await peekTable(buffer, source);
    const saved = await this.mappings.findByFingerprint(handler.resource, headerFingerprint(headers));
    if (!saved) return { headers, sample, suggestedMapping: suggestMapping(headers, handler.fields), matchedMapping: null };

    // O fingerprint casa pelo cabeçalho normalizado; o mapeamento salvo guarda a grafia do arquivo antigo
    // ("Cód. Barras"). Cada valor é traduzido para a grafia do arquivo atual ("COD BARRAS").
    const byNormalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
    const suggestedMapping: Record<string, string> = {};
    for (const [field, header] of Object.entries(saved.mapping)) {
      const current = byNormalized.get(normalizeHeader(header));
      if (current) suggestedMapping[field] = current;
    }
    await this.mappings.touch(saved.id);
    return { headers, sample, suggestedMapping, matchedMapping: { id: saved.id, name: saved.name } };
  }

  private async findDuplicate(job: ImportJob): Promise<UploadResult['duplicateOf']> {
    const [row]: { jobId: string; fileName: string; appliedAt: Date | null; createdByName: string | null }[] =
      await getTenantManager().query(
        `SELECT j.id AS "jobId", j."fileName", COALESCE(j."appliedAt", j."completedAt") AS "appliedAt", u.name AS "createdByName"
           FROM import_jobs j
           LEFT JOIN users u ON u.id = j."createdByUserId"
          WHERE j."fileHash" = $1 AND j.status = 'completed' AND j.id <> $2
          ORDER BY j."createdAt" DESC
          LIMIT 1`,
        [job.fileHash, job.id],
      );
    if (!row) return null;
    return { ...row, appliedAt: row.appliedAt ? new Date(row.appliedAt).toISOString() : null };
  }
}

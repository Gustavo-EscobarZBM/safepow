import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { afterCommit, getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { StorageService } from '../uploads/storage.service';
import { assertSafeZip, decodeCsv, detectDelimiter, detectFormat, ImportFileError } from './engine/file-sniff';
import { headerFingerprint, suggestMapping } from './engine/mapping';
import { listSheets, peekTable, TableSource } from './engine/sheet-reader';
import { ImportResourceHandler, MissingPage } from './engine/types';
import { ListImportRowsDto, PageQueryDto } from './dto/list-import-rows.dto';
import { SimulateImportDto } from './dto/simulate-import.dto';
import { ImportRow } from './import-row.entity';
import { getImportHandler } from './handlers';
import { ImportJob, ImportJobStatus } from './import-job.entity';
import { assertKnownFields, ImportMappingsService, mappingInvalid } from './import-mappings.service';

export const IMPORTS_QUEUE = 'imports';

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
  async simulate(id: string, dto: SimulateImportDto): Promise<ImportJob> {
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
      options: { updateFields: dto.updateFields, runId },
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

  async findOne(id: string): Promise<ImportJob> {
    const job = await getTenantManager().findOne(ImportJob, { where: { id } });
    if (!job) throw new NotFoundException('Importação não encontrada.');
    return job;
  }

  /** Antes da gravação dá para trocar aba/colunas e simular de novo; depois, não. */
  protected assertEditable(job: ImportJob, allowSimulating = false): void {
    const editable = [ImportJobStatus.UPLOADED, ImportJobStatus.SIMULATED, ImportJobStatus.FAILED];
    if (allowSimulating) editable.push(ImportJobStatus.SIMULATING);
    if (!editable.includes(job.status) || job.appliedAt) throw invalidState();
  }

  private async previewOf(handler: ImportResourceHandler, buffer: Buffer, source: TableSource): Promise<PreviewResult> {
    const { headers, sample } = await peekTable(buffer, source);
    const saved = await this.mappings.findByFingerprint(handler.resource, headerFingerprint(headers));
    return {
      headers,
      sample,
      suggestedMapping: saved ? saved.mapping : suggestMapping(headers, handler.fields),
      matchedMapping: saved ? { id: saved.id, name: saved.name } : null,
    };
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

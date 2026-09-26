import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { StorageService } from '../uploads/storage.service';
import { assertSafeZip, decodeCsv, detectDelimiter, detectFormat, ImportFileError } from './engine/file-sniff';
import { headerFingerprint, suggestMapping } from './engine/mapping';
import { listSheets, peekTable, TableSource } from './engine/sheet-reader';
import { ImportResourceHandler } from './engine/types';
import { getImportHandler } from './handlers';
import { ImportJob, ImportJobStatus } from './import-job.entity';
import { ImportMappingsService } from './import-mappings.service';

export const IMPORTS_QUEUE = 'imports';

export interface ImportQueueData {
  jobId: string;
  companyId: string;
  runId: string;
}

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

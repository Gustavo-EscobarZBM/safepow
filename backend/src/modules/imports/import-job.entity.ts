import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';

export enum ImportJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  // Importação 2.0 (SP3, spec 1): upload → simulação → confirmação/aprovação → gravação → reversão.
  UPLOADED = 'uploaded',
  SIMULATING = 'simulating',
  SIMULATED = 'simulated',
  PENDING_APPROVAL = 'pending_approval',
  APPLYING = 'applying',
  CANCELLED = 'cancelled',
  ROLLING_BACK = 'rolling_back',
  ROLLED_BACK = 'rolled_back',
}

export type RowAction = 'create' | 'update' | 'reactivate' | 'unchanged' | 'error' | 'duplicate' | 'archive';

export interface ImportOptions {
  updateFields: string[];
  archiveMissing?: boolean;
  confirmArchiveCount?: number;
  /** Identifica a execução enfileirada: mensagem com outro runId é de uma simulação substituída. */
  runId?: string;
  /** Execução do worker que está com o job (protege contra reentrega da mesma mensagem). */
  attemptId?: string;
  /** Identifica a gravação enfileirada (mesmo papel do runId na simulação). */
  applyRunId?: string;
  /** Quando a gravação começou (a partir daí o job não volta a ser simulado). */
  applyStartedAt?: string;
  /** Última vez que a gravação foi enfileirada (para detectar gravação parada). */
  applyRequestedAt?: string;
  /** Quem liberou a gravação (o próprio autor ou quem aprovou o pedido). */
  actorUserId?: string;
}

export interface ImportSummary {
  totalRows: number;
  counts: Record<RowAction, number>;
  warnings: Record<string, number>;
  missingCount: number;
  sensitive: { priceChange: number; archiveWithHistory: number };
  appliedCount?: number;
  rolledBackCount?: number;
  conflictCount?: number;
  rowsPurged?: boolean;
}

export interface ImportRowError {
  row: number;
  error: string;
}

// Representa o "relatório de importação" citado na Seção 5.2 do documento:
// o gerente sobe a planilha, recebe um jobId na hora, e consulta este
// registro depois para saber quantas linhas foram importadas com sucesso e
// quais falharam (e por quê) — sem travar a requisição HTTP original.
@Entity('import_jobs')
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'varchar', length: 20, default: ImportJobStatus.UPLOADED })
  status: ImportJobStatus;

  @Column({ length: 40, default: 'products' })
  resource: string;

  @Column({ length: 255 })
  fileName: string;

  // Chave do arquivo bruto no object storage (Seção 5.2) — não a URL pública.
  @Column({ length: 500 })
  storageKey: string;

  @Column({ type: 'int', nullable: true })
  totalRows: number | null;

  @Column({ type: 'int', default: 0 })
  successCount: number;

  @Column({ type: 'int', default: 0 })
  errorCount: number;

  @Column({ type: 'jsonb', nullable: true })
  errorReport: ImportRowError[] | null;

  @Column({ type: 'char', length: 64, nullable: true })
  fileHash: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  format: 'xlsx' | 'csv' | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  encoding: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  delimiter: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sheetName: string | null;

  @Column({ type: 'jsonb', nullable: true })
  headers: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  sheets: string[] | null;

  /** Campo do handler ⇒ cabeçalho da planilha. */
  @Column({ type: 'jsonb', nullable: true })
  mapping: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  options: ImportOptions | null;

  @Column({ type: 'jsonb', nullable: true })
  summary: ImportSummary | null;

  /** CSV completo de erros/avisos no storage (o errorReport guarda só os 200 primeiros, para a tela). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  errorReportKey: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  changeRequestId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  simulatedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rolledBackAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

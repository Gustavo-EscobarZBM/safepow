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

  @Column({ type: 'enum', enum: ImportJobStatus, default: ImportJobStatus.PENDING })
  status: ImportJobStatus;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

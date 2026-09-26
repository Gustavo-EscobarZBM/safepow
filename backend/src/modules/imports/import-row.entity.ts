import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RowAction } from './import-job.entity';

/**
 * Tabela de preparação da importação 2.0 (SP3, spec 1.2): uma linha por linha da planilha (ou por produto
 * ausente arquivado), com a simulação (ação, diff, avisos) e, depois da gravação, o "antes" que sustenta a
 * reversão. Expurgada 30 dias depois.
 */
@Entity('import_rows')
export class ImportRow {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @Column({ type: 'int', nullable: true })
  rowNumber: number | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, string | null> | null;

  @Column({ type: 'jsonb', nullable: true })
  normalized: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  key: string | null;

  @Column({ type: 'varchar', length: 12 })
  action: RowAction;

  @Column({ type: 'jsonb', nullable: true })
  diff: Record<string, { from: unknown; to: unknown }> | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  warnings: string[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  errors: string[];

  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  appliedAction: RowAction | null;

  @Column({ type: 'timestamptz', nullable: true })
  appliedUpdatedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rolledBackAt: Date | null;
}

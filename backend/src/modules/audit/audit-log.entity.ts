import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Trilha de auditoria (migration 1700000015000). Append-only e gravada SÓ pela função audit_insert
 * (trigger/eventos) — a aplicação apenas lê; todas as colunas são insert/update: false.
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'bigint', insert: false, update: false }) seq: string;
  @Column({ type: 'uuid', insert: false, update: false }) companyId: string;
  @Column({ type: 'uuid', nullable: true, insert: false, update: false }) actorUserId: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true, insert: false, update: false }) actorName: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true, insert: false, update: false }) actorRole: string | null;
  @Column({ type: 'varchar', length: 40, insert: false, update: false }) entityType: string;
  @Column({ type: 'uuid', nullable: true, insert: false, update: false }) entityId: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true, insert: false, update: false }) entityLabel: string | null;
  @Column({ type: 'varchar', length: 20, insert: false, update: false }) action: string;
  @Column({ type: 'jsonb', insert: false, update: false }) changes: { field: string; from: unknown; to: unknown }[];
  @Column({ type: 'jsonb', nullable: true, insert: false, update: false }) summary: Record<string, unknown> | null;
  @Column({ type: 'varchar', length: 20, insert: false, update: false }) source: string;
  @Column({ type: 'text', nullable: true, insert: false, update: false }) reason: string | null;
  @Column({ type: 'uuid', nullable: true, insert: false, update: false }) requestId: string | null;
  @Column({ type: 'inet', nullable: true, insert: false, update: false }) ip: string | null;
  @CreateDateColumn({ type: 'timestamptz', insert: false, update: false }) createdAt: Date;
}

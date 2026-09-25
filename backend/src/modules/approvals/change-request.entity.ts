import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

/** Pedido de mudança sensível aguardando outro gerente (SP2, etapa 2.2 — migration 1700000017000). */
@Entity('change_requests')
export class ChangeRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) companyId: string;
  @Column({ type: 'varchar', length: 30 }) policy: string;
  @Column({ type: 'varchar', length: 40 }) entityType: string;
  @Column({ type: 'uuid', nullable: true }) entityId: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) entityLabel: string | null;
  @Column({ type: 'varchar', length: 20 }) operation: string;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;
  @Column({ type: 'text' }) justification: string;
  @Column({ type: 'varchar', length: 20, default: 'pending' }) status: ChangeRequestStatus;
  @Column({ type: 'uuid', nullable: true }) requestedByUserId: string | null;
  @Column({ type: 'uuid', nullable: true }) decidedByUserId: string | null;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date | null;
  @Column({ type: 'text', nullable: true }) decisionNote: string | null;
  @Column({ type: 'timestamptz', insert: false }) expiresAt: Date;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

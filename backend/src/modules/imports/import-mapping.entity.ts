import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Mapeamento de colunas salvo (SP3, spec 1.3): reaplicado quando os cabeçalhos da planilha batem. */
@Entity('import_mappings')
export class ImportMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ length: 40 })
  resource: string;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'jsonb' })
  mapping: Record<string, string>;

  @Column({ type: 'char', length: 64 })
  headerFingerprint: string;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}

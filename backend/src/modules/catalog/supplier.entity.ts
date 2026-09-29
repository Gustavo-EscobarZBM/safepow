import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Company } from '../companies/company.entity';

// Fornecedor principal do produto (SP4 4.1) — base do relatório de perdas por fornecedor.
@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ length: 120 })
  name: string;

  // CNPJ ou CPF, como o usuário digitou.
  @Column({ type: 'varchar', length: 18, nullable: true })
  taxId: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  contactName: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

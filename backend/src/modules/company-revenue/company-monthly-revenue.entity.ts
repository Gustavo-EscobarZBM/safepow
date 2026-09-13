import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';

// Faturamento mensal informado manualmente pelo gerente (Painel > Dashboard) —
// usado só para calcular a taxa de perda sobre faturamento. Ver spec seção 3.
@Entity('company_monthly_revenue')
@Index(['companyId', 'year', 'month'], { unique: true })
export class CompanyMonthlyRevenue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  revenueAmount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

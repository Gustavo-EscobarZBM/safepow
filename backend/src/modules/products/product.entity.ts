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

// Catálogo de produtos de cada empresa cliente. Alimentado por cadastro manual
// ou pela importação de planilha (Seção 5 do documento).
@Entity('products')
@Index(['companyId', 'barcode'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, (company) => company.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  // Código de barras (EAN/UPC) escaneado no app — Seção 1 (registro do produto).
  @Column({ length: 64 })
  barcode: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  sku: string | null;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  unitPrice: number;

  // Guarda o nome original da coluna do ERP do cliente para reaproveitar
  // o mapeamento nas próximas importações (Seção 5.4).
  @Column({ type: 'jsonb', nullable: true })
  sourceColumnMapping: Record<string, string> | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

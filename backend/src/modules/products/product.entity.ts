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

export const PRODUCT_UNITS = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'DZ', 'M'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];
/** Unidades em que a quantidade da perda pode ter casas decimais (0,850 kg). */
export const FRACTIONAL_UNITS: readonly ProductUnit[] = ['KG', 'G', 'L', 'ML', 'M'];

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

  // Preço de custo (o que a empresa pagou) — separado de unitPrice (preço de
  // venda) para calcular o prejuízo de custo real nos relatórios. 4 casas desde o
  // SP4 4.1: item vendido por peso/fracionado tem custo unitário com mais precisão.
  @Column({ type: 'numeric', precision: 12, scale: 4, default: 0 })
  costPrice: number;

  // Dados de catálogo (SP4 4.1). Taxonomias arquivadas continuam ligadas; só não podem ser escolhidas de novo.
  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ type: 'uuid', nullable: true })
  brandId: string | null;

  @Column({ type: 'uuid', nullable: true })
  supplierId: string | null;

  @Column({ type: 'varchar', length: 4, default: 'UN' })
  unit: ProductUnit;

  @Column({ default: false })
  isPerishable: boolean;

  @Column({ type: 'int', nullable: true })
  shelfLifeDays: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Eixo separado de isActive: 'pending' = cadastrado em campo aguardando revisão (SP6).
  @Column({ type: 'varchar', length: 10, default: 'approved' })
  reviewStatus: 'approved' | 'pending';

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

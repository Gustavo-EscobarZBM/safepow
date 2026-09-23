import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type PriceChangeSource = 'manual' | 'import' | 'bulk' | 'retro_fix' | 'erp' | 'approval' | 'backfill';

/**
 * Histórico de preço/custo (migration 1700000011000). Append-only e alimentado SÓ pelo trigger
 * record_product_price_history em "products" — a aplicação apenas lê. Por isso todas as colunas são
 * insert: false / update: false: um save() acidental não grava nada aqui.
 */
@Entity('product_price_history')
export class ProductPriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // bigint chega como string pelo driver pg. Desempate de linhas com o mesmo validFrom.
  @Column({ type: 'bigint', insert: false, update: false })
  seq: string;

  @Column({ type: 'uuid', insert: false, update: false })
  companyId: string;

  @Column({ type: 'uuid', insert: false, update: false })
  productId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, insert: false, update: false })
  unitPrice: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, insert: false, update: false })
  costPrice: number;

  @Column({ type: 'timestamptz', insert: false, update: false })
  validFrom: Date;

  @Column({ type: 'uuid', nullable: true, insert: false, update: false })
  changedByUserId: string | null;

  @Column({ type: 'varchar', length: 20, insert: false, update: false })
  source: PriceChangeSource;

  @CreateDateColumn({ type: 'timestamptz', insert: false, update: false })
  createdAt: Date;
}

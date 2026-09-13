import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';
import { LossLocation } from '../loss-locations/loss-location.entity';
import { LossReason } from '../loss-reasons/loss-reason.entity';
import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';

// Registros anteriores à introdução deste campo ficam com source = null —
// não há como inferir retroativamente se vieram do app ou do painel.
export enum LossSource {
  MOBILE = 'mobile',
  WEB = 'web',
}

@Entity('losses')
// clientGeneratedId é o UUID criado no próprio celular (Seção 4.2 do documento):
// garante que reenvios do app após reconexão não dupliquem o registro (idempotência).
@Index(['companyId', 'clientGeneratedId'], { unique: true })
export class Loss {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, (company) => company.losses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'uuid' })
  clientGeneratedId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  // Funcionário que registrou a perda pelo app.
  @Column({ type: 'uuid' })
  reportedByUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reportedByUserId' })
  reportedBy: User;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 1 })
  quantity: number;

  // Local da ocorrência — seleção obrigatória a partir do catálogo cadastrado
  // pelo Gerente em Cadastros > Local da Perda (RESTRICT: não dá pra excluir
  // um local que já tem perda registrada com ele).
  @Column({ type: 'uuid' })
  locationId: string;

  @ManyToOne(() => LossLocation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'locationId' })
  location: LossLocation;

  // Motivo da perda — mesma lógica do local, catálogo em Cadastros > Motivo da Perda.
  @Column({ type: 'uuid' })
  reasonId: string;

  @ManyToOne(() => LossReason, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reasonId' })
  reason: LossReason;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // De onde veio o registro — app mobile (funcionário) ou formulário do
  // painel web. Alimenta a coluna "Origem" na listagem do gerente.
  @Column({ type: 'enum', enum: LossSource, nullable: true })
  source: LossSource | null;

  // URL no object storage (S3/Spaces) — Seção 2.3. Upload opcional.
  @Column({ type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  // Conferência de descarte (spec seção 5) — travado no momento da criação a
  // partir de company.lossVerificationEnabled (ver LossesService.create).
  @Column({ type: 'boolean', default: false })
  requiresVerification: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedByUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'verifiedByUserId' })
  verifiedBy: User | null;

  // Momento em que a perda ocorreu segundo o funcionário (pode ser anterior ao
  // momento de sincronização, já que o registro pode ter sido feito offline).
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Product } from '../products/product.entity';
import { Loss } from '../losses/loss.entity';

// Status do ciclo de vida comercial da empresa cliente (tenant).
// Ver Seção 6 do documento de arquitetura: o middleware de licenciamento
// bloqueia o acesso quando o status sai de TRIAL/ACTIVE.
export enum CompanyStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  PAST_DUE = 'past_due', // pagamento falhou, ainda em período de tolerância
  BLOCKED = 'blocked', // inadimplente além da tolerância, ou bloqueio manual
  CANCELED = 'canceled',
}

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 180 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 18, nullable: true })
  cnpj: string | null;

  @Column({ type: 'enum', enum: CompanyStatus, default: CompanyStatus.TRIAL })
  status: CompanyStatus;

  // Plano contratado — usado para limites de usuários/lojas e para exibir no Painel Master.
  @Column({ length: 60, default: 'starter' })
  planTier: string;

  // Data até quando o trial ou o período pago corrente é válido.
  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  // Referência ao cliente na plataforma de cobrança (Stripe/Asaas/Vindi) — Seção 6.3.
  @Column({ type: 'varchar', length: 120, nullable: true })
  billingProviderCustomerId: string | null;

  // Marca a última vez que o Administrador Master reativou o acesso manualmente
  // (ação "Desbloquear") sem gerar um novo ciclo de cobrança. Usado por
  // computeEffectiveStatus para não bloquear de novo automaticamente pelo mesmo
  // vencimento já perdoado — só volta a valer no próximo ciclo (após "Renovar").
  @Column({ type: 'timestamptz', nullable: true })
  lastManualUnlockAt: Date | null;

  // Conferência de descarte (opcional, ativada pelo gerente) — spec seção 5.
  @Column({ type: 'boolean', default: false })
  lossVerificationEnabled: boolean;

  @Column({ type: 'uuid', nullable: true })
  lossVerifierId: string | null;

  // Políticas de aprovação (SP2, 2.2 — migration 1700000017000). Normalizadas por approval-policies.ts.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  approvalPolicies: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.company)
  users: User[];

  @OneToMany(() => Product, (product) => product.company)
  products: Product[];

  @OneToMany(() => Loss, (loss) => loss.company)
  losses: Loss[];
}

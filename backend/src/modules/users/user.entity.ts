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

// MASTER_ADMIN: você/sua equipe — não pertence a nenhuma empresa cliente (companyId = null),
//   acessa o Painel Master (Seção 6.1).
// MANAGER: gerente da empresa cliente — acessa o painel web gerencial (funcionalidade 2).
// EMPLOYEE: funcionário da empresa cliente — acessa apenas o app mobile (funcionalidade 1).
export enum UserRole {
  MASTER_ADMIN = 'master_admin',
  MANAGER = 'manager',
  EMPLOYEE = 'employee',
}

@Entity('users')
@Index(['email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nulo apenas para usuários MASTER_ADMIN — todos os demais pertencem a um tenant.
  @Column({ type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, (company) => company.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company | null;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 180 })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.EMPLOYEE })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

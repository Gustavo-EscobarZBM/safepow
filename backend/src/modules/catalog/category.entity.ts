import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Company } from '../companies/company.entity';

// Categoria do produto (SP4 4.1): árvore de até 3 níveis por empresa (Mercearia › Bebidas › Refrigerantes).
// Unicidade (empresa, pai, nome sem caixa) e regras da árvore ficam no banco (migration 1700000020000).
@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

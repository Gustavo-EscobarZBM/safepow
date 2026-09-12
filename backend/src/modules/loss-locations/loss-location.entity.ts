import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Company } from '../companies/company.entity';

// Catálogo de locais de perda por empresa (Painel > Cadastros > Local da
// Perda). Antes era um enum fixo no código; virou tabela para o Gerente poder
// cadastrar/excluir suas próprias opções sem depender de deploy.
@Entity('loss_locations')
@Index(['companyId', 'name'], { unique: true })
export class LossLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ length: 120 })
  name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

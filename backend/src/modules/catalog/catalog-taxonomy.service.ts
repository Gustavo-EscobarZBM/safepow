import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const TREE_ERROR_PREFIX = 'categoria: ';

export interface TaxonomyRecord extends ObjectLiteral {
  id: string;
  name: string;
  isActive: boolean;
}

export interface TaxonomyMessages {
  duplicate: string;
  notFound: string;
}

/**
 * Serviço genérico das taxonomias do catálogo (SP4 4.1): marcas, fornecedores e — com as regras de árvore em
 * CategoriesService — categorias. Nada é apagado: arquivar/reativar mexe só em isActive e não toca nos produtos.
 */
export class CatalogTaxonomyService<T extends TaxonomyRecord> {
  constructor(
    protected readonly entity: new () => T,
    protected readonly messages: TaxonomyMessages,
  ) {}

  list(includeArchived: boolean): Promise<T[]> {
    const qb = getTenantManager().createQueryBuilder(this.entity, 't');
    if (!includeArchived) qb.where('t.isActive = true');
    return qb.orderBy('lower(t.name)', 'ASC').getMany();
  }

  async create(data: Partial<T>): Promise<T> {
    const manager = getTenantManager();
    const record = manager.create(this.entity, {
      ...data,
      name: data.name!.trim(),
      companyId: getTenantContext().companyId!,
    } as never) as T;
    await this.assertUniqueName(manager, record);
    return this.save(manager, record);
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const manager = getTenantManager();
    const record = await this.findOrFail(manager, id);
    Object.assign(record, data);
    if (data.name !== undefined) (record as TaxonomyRecord).name = data.name.trim();
    await this.assertUniqueName(manager, record);
    return this.save(manager, record);
  }

  async archive(id: string): Promise<T> {
    const manager = getTenantManager();
    const record = await this.findOrFail(manager, id);
    await this.beforeArchive(manager, record);
    (record as TaxonomyRecord).isActive = false;
    return this.save(manager, record);
  }

  async restore(id: string): Promise<T> {
    const manager = getTenantManager();
    const record = await this.findOrFail(manager, id);
    await this.beforeRestore(manager, record);
    (record as TaxonomyRecord).isActive = true;
    return this.save(manager, record);
  }

  protected async findOrFail(manager: EntityManager, id: string): Promise<T> {
    const record = await manager.findOne(this.entity, { where: { id } as never });
    if (!record) throw new NotFoundException(this.messages.notFound);
    return record;
  }

  /** Mesmo nome sem diferenciar maiúsculas (categorias: dentro do mesmo pai — ver CategoriesService). */
  protected async assertUniqueName(manager: EntityManager, record: T): Promise<void> {
    const qb = manager.createQueryBuilder(this.entity, 't').where('lower(t.name) = lower(:name)', { name: record.name });
    if (record.id) qb.andWhere('t.id <> :id', { id: record.id });
    this.scopeUniqueness(qb, record);
    if (await qb.getExists()) throw new ConflictException(this.messages.duplicate);
  }

  protected scopeUniqueness(_qb: SelectQueryBuilder<T>, _record: T): void {}

  protected async beforeArchive(_manager: EntityManager, _record: T): Promise<void> {}

  protected async beforeRestore(_manager: EntityManager, _record: T): Promise<void> {}

  /** Corrida entre duas gravações (índice único) e regras de árvore do banco viram 409/400 legíveis. */
  protected async save(manager: EntityManager, record: T): Promise<T> {
    try {
      return await manager.save(this.entity, record);
    } catch (err) {
      const { code, message } = err as { code?: string; message?: string };
      if (code === UNIQUE_VIOLATION) throw new ConflictException(this.messages.duplicate);
      if (code === CHECK_VIOLATION && message?.startsWith(TREE_ERROR_PREFIX)) {
        throw new BadRequestException(message.slice(TREE_ERROR_PREFIX.length));
      }
      throw err;
    }
  }
}

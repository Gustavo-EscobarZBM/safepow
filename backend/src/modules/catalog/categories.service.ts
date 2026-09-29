import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager, SelectQueryBuilder } from 'typeorm';
import { getTenantManager } from '../../common/tenant/tenant-storage';
import { CatalogTaxonomyService } from './catalog-taxonomy.service';
import { Category } from './category.entity';

export type CategoryWithPath = Category & { path: string };

export const CATEGORY_PATH_SEPARATOR = ' > ';

/** id → caminho legível ("Mercearia > Bebidas") de todas as categorias da empresa, arquivadas inclusive. */
export async function categoryPathMap(manager: EntityManager): Promise<Map<string, string>> {
  const rows: { id: string; name: string; parentId: string | null }[] = await manager.query(
    `SELECT id, name, "parentId" FROM categories`,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, depth = 0): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const row = byId.get(id)!;
    const parent = row.parentId && byId.has(row.parentId) && depth < 5 ? pathOf(row.parentId, depth + 1) : null;
    const path = parent ? parent + CATEGORY_PATH_SEPARATOR + row.name : row.name;
    paths.set(id, path);
    return path;
  };
  for (const row of rows) pathOf(row.id);
  return paths;
}

@Injectable()
export class CategoriesService extends CatalogTaxonomyService<Category> {
  constructor() {
    super(Category, { duplicate: 'Já existe uma categoria com este nome neste nível.', notFound: 'Categoria não encontrada.' });
  }

  async listWithPath(includeArchived: boolean): Promise<CategoryWithPath[]> {
    const items = await this.list(includeArchived);
    const paths = await categoryPathMap(getTenantManager());
    return items
      .map((c) => ({ ...c, path: paths.get(c.id) ?? c.name }))
      .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { sensitivity: 'base' }));
  }

  async withPath(category: Category): Promise<CategoryWithPath> {
    const paths = await categoryPathMap(getTenantManager());
    return { ...category, path: paths.get(category.id) ?? category.name };
  }

  protected scopeUniqueness(qb: SelectQueryBuilder<Category>, record: Category): void {
    if (record.parentId) qb.andWhere('t.parentId = :parentId', { parentId: record.parentId });
    else qb.andWhere('t.parentId IS NULL');
  }

  protected async beforeArchive(manager: EntityManager, record: Category): Promise<void> {
    const activeChild = await manager.exists(Category, { where: { parentId: record.id, isActive: true } });
    if (activeChild) throw new ConflictException('Arquive primeiro as subcategorias.');
  }

  protected async beforeRestore(manager: EntityManager, record: Category): Promise<void> {
    if (!record.parentId) return;
    const parent = await manager.findOne(Category, { where: { id: record.parentId } });
    if (parent && !parent.isActive) throw new ConflictException('Reative primeiro a categoria pai.');
  }
}

import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { categoryPathMap } from '../catalog/categories.service';
import { Product } from './product.entity';

/** Produto como o painel recebe (SP4 4.1): com os nomes legíveis das taxonomias ligadas. */
export type ProductView = Product & {
  categoryPath: string | null;
  brandName: string | null;
  supplierName: string | null;
};

const TAXONOMIES = [
  { field: 'categoryId', table: 'categories', message: 'Categoria inválida ou arquivada.' },
  { field: 'brandId', table: 'brands', message: 'Marca inválida ou arquivada.' },
  { field: 'supplierId', table: 'suppliers', message: 'Fornecedor inválido ou arquivado.' },
] as const;

type TaxonomyIds = Partial<Record<(typeof TAXONOMIES)[number]['field'], string | null>>;

/**
 * Só taxonomias ativas podem ser ESCOLHIDAS. Manter a que o produto já tem (mesmo arquivada depois) é permitido —
 * editar o nome de um produto não pode exigir trocar uma categoria que foi arquivada.
 */
export async function assertSelectableTaxonomies(manager: EntityManager, ids: TaxonomyIds, current?: Product): Promise<void> {
  for (const { field, table, message } of TAXONOMIES) {
    const id = ids[field];
    if (!id || id === current?.[field]) continue;
    const [row] = await manager.query(`SELECT 1 FROM ${table} WHERE id = $1 AND "isActive"`, [id]);
    if (!row) throw new BadRequestException(message);
  }
}

async function namesById(manager: EntityManager, table: 'brands' | 'suppliers', ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows: { id: string; name: string }[] = await manager.query(`SELECT id, name FROM ${table} WHERE id = ANY($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function withCatalogLabels(manager: EntityManager, products: Product[]): Promise<ProductView[]> {
  const distinct = (field: 'brandId' | 'supplierId') => [...new Set(products.map((p) => p[field]).filter((id): id is string => !!id))];
  const [paths, brands, suppliers] = [
    products.some((p) => p.categoryId) ? await categoryPathMap(manager) : new Map<string, string>(),
    await namesById(manager, 'brands', distinct('brandId')),
    await namesById(manager, 'suppliers', distinct('supplierId')),
  ];
  return products.map((p) =>
    Object.assign(p, {
      categoryPath: p.categoryId ? (paths.get(p.categoryId) ?? null) : null,
      brandName: p.brandId ? (brands.get(p.brandId) ?? null) : null,
      supplierName: p.supplierId ? (suppliers.get(p.supplierId) ?? null) : null,
    }),
  );
}

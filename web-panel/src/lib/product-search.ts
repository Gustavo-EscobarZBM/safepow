import type { ProductStatusFilter } from './types';

export const PRODUCT_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Caminho de GET /products/search. Só manda os parâmetros que o backend conhece (ele responde 400 a
 * parâmetro desconhecido) e deixa o URLSearchParams codificar o texto (%, &, espaços).
 */
/** Filtros de catálogo da lista de produtos (SP4 4.1); vazio = sem filtro. */
export interface ProductCatalogFilters {
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  unit?: string;
}

export const PRODUCT_FILTER_KEYS = ['categoryId', 'brandId', 'supplierId', 'unit'] as const;

export function productSearchPath({
  q,
  status,
  page,
  pageSize,
  filters = {},
}: {
  q: string;
  status: ProductStatusFilter;
  page: number;
  pageSize: number;
  filters?: ProductCatalogFilters;
}): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('status', status);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  for (const key of PRODUCT_FILTER_KEYS) {
    if (filters[key]) params.set(key, filters[key]!);
  }
  return `products/search?${params.toString()}`;
}

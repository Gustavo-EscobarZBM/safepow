import type { ProductStatusFilter } from './types';

export const PRODUCT_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Caminho de GET /products/search. Só manda os parâmetros que o backend conhece (ele responde 400 a
 * parâmetro desconhecido) e deixa o URLSearchParams codificar o texto (%, &, espaços).
 */
export function productSearchPath({
  q,
  status,
  page,
  pageSize,
}: {
  q: string;
  status: ProductStatusFilter;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('status', status);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return `products/search?${params.toString()}`;
}

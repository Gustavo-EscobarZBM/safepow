import { Product } from './product.entity';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface ProductSearchResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Escapa os curingas do LIKE (%, _) e a própria barra invertida, para o texto digitado ser procurado
 * literalmente — "100%" procura "100%", não "tudo que começa com 100". Usar com `ESCAPE '\'`.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

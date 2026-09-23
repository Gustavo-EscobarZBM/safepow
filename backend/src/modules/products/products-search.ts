import { Product } from './product.entity';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/**
 * Teto de página: sem ele, `page=99999999999999999999` passa no @IsInt (1e20 é inteiro em JS) e o offset
 * vira `OFFSET 2e+21` no SQL — erro 500. 100 mil páginas × 100 itens = 10 milhões de produtos, muito além
 * de qualquer catálogo real.
 */
export const MAX_PAGE = 100_000;

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

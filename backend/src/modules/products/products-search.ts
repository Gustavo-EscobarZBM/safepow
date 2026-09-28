import { Brackets, SelectQueryBuilder } from 'typeorm';
import type { ProductStatusFilter } from './dto/search-products.dto';
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

/**
 * Filtros da busca do painel (F10), compartilhados com a exportação (SP3, 3.3) para exportar exatamente o que a tela
 * mostra: status (padrão `active`) e texto — nome por conteúdo, código de barras e SKU por prefixo, curingas escapados.
 */
export function applyProductFilters(
  qb: SelectQueryBuilder<Product>,
  filters: { q?: string; status?: ProductStatusFilter },
): void {
  const status = filters.status ?? 'active';
  if (status !== 'all') {
    qb.andWhere('product.isActive = :isActive', { isActive: status === 'active' });
  }
  const term = filters.q?.trim();
  if (term) {
    const escaped = escapeLikePattern(term);
    qb.andWhere(
      new Brackets((where) => {
        where
          .where(`product.name ILIKE :contains ESCAPE '\\'`, { contains: `%${escaped}%` })
          .orWhere(`product.barcode LIKE :prefix ESCAPE '\\'`, { prefix: `${escaped}%` })
          .orWhere(`product.sku ILIKE :prefix ESCAPE '\\'`, { prefix: `${escaped}%` });
      }),
    );
  }
}

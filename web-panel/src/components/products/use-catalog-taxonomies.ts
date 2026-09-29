'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Brand, Category, Supplier } from '@/lib/types';

export interface CatalogTaxonomies {
  categories: Category[];
  brands: Brand[];
  suppliers: Supplier[];
}

const EMPTY: CatalogTaxonomies = { categories: [], brands: [], suppliers: [] };

/**
 * Categorias, marcas e fornecedores (arquivados inclusive, para rotular o que um produto já usa) para os selects e
 * filtros da tela de produtos (SP4 4.1). Falha ao carregar não bloqueia a tela: os selects ficam só com "Sem …".
 */
export function useCatalogTaxonomies(): CatalogTaxonomies {
  const [taxonomies, setTaxonomies] = useState<CatalogTaxonomies>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const categories = await api.get<Category[]>('categories?includeArchived=true');
        const brands = await api.get<Brand[]>('brands?includeArchived=true');
        const suppliers = await api.get<Supplier[]>('suppliers?includeArchived=true');
        if (!cancelled) setTaxonomies({ categories, brands, suppliers });
      } catch {
        // Sem taxonomias a tela continua funcionando (cadastro e busca sem esses campos).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return taxonomies;
}

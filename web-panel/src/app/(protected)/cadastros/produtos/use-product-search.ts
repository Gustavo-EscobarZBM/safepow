'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { PRODUCT_PAGE_SIZE, productSearchPath, SEARCH_DEBOUNCE_MS } from '@/lib/product-search';
import type { ProductSearchResult, ProductStatusFilter } from '@/lib/types';

/**
 * Busca de produtos no servidor (SP1, etapa 1.3 — F10): texto com debounce, aba de status, página e
 * recarga. Cada busca ganha um número; só a resposta da última pedida é aplicada, então digitar rápido ou
 * trocar de aba nunca deixa um resultado velho na tela.
 */
export function useProductSearch() {
  const [search, setSearchValue] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatusValue] = useState<ProductStatusFilter>('active');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<ProductSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    api
      .get<ProductSearchResult>(
        productSearchPath({ q: debouncedSearch, status, page, pageSize: PRODUCT_PAGE_SIZE }),
      )
      .then((data) => {
        if (latestRequest.current !== requestId) return;
        setResult(data);
        setError(null);
      })
      .catch((e) => {
        if (latestRequest.current !== requestId) return;
        setError(e instanceof ApiError ? e.message : 'Erro ao carregar produtos.');
      })
      .finally(() => {
        if (latestRequest.current === requestId) setLoading(false);
      });
  }, [debouncedSearch, status, page, reloadKey]);

  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE));

  // A página pedida deixou de existir (ex.: arquivou o último item da última página): vai para a última.
  useEffect(() => {
    if (result && result.items.length === 0 && result.total > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [result, page, totalPages]);

  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPage(1);
  }, []);

  const setStatus = useCallback((value: ProductStatusFilter) => {
    setStatusValue(value);
    setPage(1);
  }, []);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return {
    search,
    setSearch,
    status,
    setStatus,
    page,
    setPage,
    items: result?.items ?? [],
    total,
    totalPages,
    loading,
    error,
    reload,
  };
}

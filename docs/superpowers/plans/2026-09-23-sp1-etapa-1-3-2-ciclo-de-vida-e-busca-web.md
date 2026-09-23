# SP1 · Sub-etapa 1.3.2 — Ciclo de vida do produto e busca no servidor (painel web) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela Cadastros › Produtos passa a buscar e paginar no servidor (`GET /products/search`), com
abas Ativos | Arquivados | Todos, "Excluir" vira "Arquivar", arquivados ganham "Reativar", e cadastrar
um código de produto arquivado oferece "Reativar e atualizar os dados".

**Architecture:** Um hook `useProductSearch` concentra busca com debounce de 300 ms, status, página,
recarga e descarte de respostas atrasadas (contador de requisições); a página só renderiza. O
`ApiError` passa a carregar `errorCode` e `data` do corpo de erro do backend. Uma tarefa de backend
fecha o achado menor da revisão da 1.3.1 (409 do `update` sem `errorCode`).

**Tech Stack:** Next.js 14 (App Router, `'use client'`), React 18, Tailwind, shadcn/ui (Radix Tabs,
Dialog), Vitest 2 + Testing Library (jsdom); backend NestJS 10 + Jest.

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md),
seção 5.2 (web) e 5.3 (testes web). Contratos consumidos: seção 5.1, implementados na 1.3.1.

## Global Constraints

- **Spec 5.2 (literal):** lista usa `products/search` com **debounce de 300 ms**, `page` e `total` do
  servidor (some o `filter` no navegador e o `paginate()` local); abas **Ativos | Arquivados | Todos**;
  ação **Reativar** nos arquivados; "Excluir" vira **"Arquivar"** (texto do diálogo: o produto some do
  app dos funcionários, o histórico de perdas é mantido, dá para reativar); cadastro que retorna
  `PRODUCT_ARCHIVED_EXISTS` mostra o aviso com o botão **"Reativar e atualizar os dados"** (`restore` +
  `PATCH` com o formulário); `ApiError` carrega `errorCode` e `data` nos dois caminhos (`request` e
  `requestForm`); `lib/types.ts` ganha `ProductSearchResult`.
- **Contrato do backend (5.1):** `GET products/search?q=&status=active|archived|all&page=&pageSize=&sort=`
  → `{ items, total, page, pageSize }`; `PATCH products/:id/restore`; `DELETE products/:id` arquiva;
  409 do cadastro `{ statusCode, errorCode, message, productId? }`. O backend rejeita parâmetros de query
  desconhecidos (400) — a web só envia `q` (quando não vazio), `status`, `page`, `pageSize`.
- Só `cadastros/produtos` muda no painel; nenhuma outra tela.
- Web: comandos em `C:\PROJETOS\SAAS\web-panel` — `npx vitest run <arquivo>`, `npm test`, `npx tsc --noEmit`.
  Backend: `C:\PROJETOS\SAAS\backend` — `npx jest <arquivo>`, `npm test`, `npm run test:int`.
- **Baselines (confirme antes da Task 1):** web 34 arquivos / 141 testes; backend 20 suítes / 137
  unitários, 15 arquivos / 76 de integração; `tsc` limpo nos dois.
- **Commits:** branch `feat/cadastros-sp1-etapa-1-3-2` a partir de `main`, um commit por tarefa, mensagem
  terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Merge/push só com confirmação.

## Review Focus

1. **Respostas fora de ordem** (digitar rápido, trocar de aba enquanto a busca anterior ainda volta): a
   lista mostra sempre o resultado da ÚLTIMA busca pedida. → Task 3, teste "resposta atrasada é descartada".
2. **Página que ficou vazia** (arquivar o único item da última página): volta para a última página que
   existe, em vez de mostrar "página 3 de 2" vazia. → Task 3, teste "página além do total".
3. **Busca com caracteres especiais** ("100%", "a&b", espaços): vai codificada na URL, sem quebrar a query
   nem mandar parâmetro extra (o backend responde 400 a parâmetro desconhecido). → Task 2, teste de
   `productSearchPath`.
4. **Reativar e atualizar quando o `PATCH` falha depois do `restore`** (ex.: nome inválido): o produto já
   foi reativado — a tela mostra o erro, mantém o formulário e recarrega a lista. → Task 5, teste
   "falha no PATCH depois do restore".
5. **Erro de conflito de um produto ATIVO** não oferece "Reativar" (só mostra a mensagem). → Task 5, teste
   "conflito com produto ativo".

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/modules/products/products.service.ts` | modificar | `update` com `barcodeConflict` e captura de `23505` |
| `backend/src/modules/products/products.service.spec.ts` | modificar | testes do conflito no `update` |
| `web-panel/src/lib/api-client.ts` | modificar | `ApiError` com `errorCode`/`data` |
| `web-panel/src/lib/api-client.spec.ts` | criar | testes do `ApiError` nos três caminhos |
| `web-panel/src/lib/types.ts` | modificar | `ProductStatusFilter`, `ProductSearchResult` |
| `web-panel/src/lib/product-search.ts` | criar | `productSearchPath`, `PRODUCT_PAGE_SIZE`, `SEARCH_DEBOUNCE_MS` |
| `web-panel/src/lib/product-search.spec.ts` | criar | testes do montador de URL |
| `web-panel/src/app/(protected)/cadastros/produtos/use-product-search.ts` | criar | hook de busca |
| `web-panel/src/app/(protected)/cadastros/produtos/use-product-search.spec.ts` | criar | testes do hook |
| `web-panel/src/app/(protected)/cadastros/produtos/page.tsx` | modificar | usa o hook, abas, arquivar/reativar, conflito |
| `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx` | modificar | testes da página |

---

### Task 1: Backend — 409 do `update` com `errorCode` (achado da revisão da 1.3.1)

**Files:**
- Modify: `backend/src/modules/products/products.service.ts` (`update`)
- Test: `backend/src/modules/products/products.service.spec.ts`

**Interfaces:**
- Consumes: `barcodeConflict`, `isBarcodeUniqueViolation` de `./product-errors` (1.3.1).
- Produces: nada novo — só o mesmo corpo de 409 também no `PATCH /products/:id`.

- [ ] **Step 1: Branch e baselines**

```bash
cd /c/PROJETOS/SAAS && git checkout main && git checkout -b feat/cadastros-sp1-etapa-1-3-2
cd backend && npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
cd ../web-panel && npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
```
Expected: backend 20/137; web 34 arquivos / 141; os dois `tsc exit=0`.

- [ ] **Step 2: Testes (vão falhar)**

Modify `backend/src/modules/products/products.service.spec.ts` — acrescentar ao fim:

```ts
describe('ProductsService.update — conflito de código de barras (etapa 1.3)', () => {
  it('trocar para o código de um produto ARQUIVADO ⇒ 409 PRODUCT_ARCHIVED_EXISTS com o productId', async () => {
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: 'prod-1', barcode: '111', isActive: true })
        .mockResolvedValueOnce({ id: 'prod-9', barcode: '999', isActive: false }),
      save: jest.fn(),
    };

    const error = await runWithTenantContext(manager, () =>
      new ProductsService().update('prod-1', { barcode: '999' }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ errorCode: 'PRODUCT_ARCHIVED_EXISTS', productId: 'prod-9' });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('edição concorrente que viola o índice único no save ⇒ 409 PRODUCT_BARCODE_EXISTS, não 500', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key'), {
      driverError: { code: '23505', constraint: 'uq_products_company_barcode' },
    });
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: 'prod-1', barcode: '111', isActive: true })
        .mockResolvedValueOnce(null),
      save: jest.fn().mockRejectedValue(uniqueViolation),
    };

    const error = await runWithTenantContext(manager, () =>
      new ProductsService().update('prod-1', { barcode: '222' }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ errorCode: 'PRODUCT_BARCODE_EXISTS' });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/products/products.service.spec.ts`
Expected: FAIL nos 2 testes novos (o 1º recebe o corpo antigo sem `errorCode`; o 2º recebe o erro cru).

- [ ] **Step 4: Implementar**

Modify `backend/src/modules/products/products.service.ts` — em `update`, trocar
```ts
      if (existing) {
        throw new ConflictException('Já existe um produto com este código de barras.');
      }
```
por
```ts
      if (existing) {
        throw barcodeConflict(existing);
      }
```
e trocar o `return manager.save(product);` do `update` por:
```ts
    try {
      return await manager.save(product);
    } catch (error) {
      if (isBarcodeUniqueViolation(error)) throw barcodeConflict(null);
      throw error;
    }
```
Se `ConflictException` deixar de ser usado no arquivo, removê-lo do import de `@nestjs/common`.

- [ ] **Step 5: Rodar, checar e commit**

```bash
npx jest src/modules/products/products.service.spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/products/products.service.ts src/modules/products/products.service.spec.ts
git commit -m "fix(backend): 409 da edição de produto com errorCode (ativo x arquivado)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; 20/139; 15/76; `tsc exit=0`.

---

### Task 2: `ApiError` com `errorCode`/`data`, tipos e montador de URL

**Files:**
- Modify: `web-panel/src/lib/api-client.ts`
- Create: `web-panel/src/lib/api-client.spec.ts`
- Modify: `web-panel/src/lib/types.ts`
- Create: `web-panel/src/lib/product-search.ts`
- Create: `web-panel/src/lib/product-search.spec.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number; errorCode?: string; data: unknown; constructor(status:
    number, message: string, data?: unknown) }`.
  - `type ProductStatusFilter = 'active' | 'archived' | 'all'`; `interface ProductSearchResult { items:
    Product[]; total: number; page: number; pageSize: number }` (`@/lib/types`).
  - `PRODUCT_PAGE_SIZE = 20`, `SEARCH_DEBOUNCE_MS = 300`, `productSearchPath({ q, status, page, pageSize }:
    { q: string; status: ProductStatusFilter; page: number; pageSize: number }): string`
    (`@/lib/product-search`).

- [ ] **Step 1: Testes (vão falhar)**

Create `web-panel/src/lib/api-client.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api-client';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body }),
  );
}

describe('ApiError — errorCode e data do corpo de erro', () => {
  afterEach(() => vi.unstubAllGlobals());

  const conflict = {
    statusCode: 409,
    errorCode: 'PRODUCT_ARCHIVED_EXISTS',
    message: 'Existe um produto arquivado com este código de barras.',
    productId: 'p-9',
  };

  it('request (JSON): carrega status, message, errorCode e o corpo em data', async () => {
    mockFetch(409, conflict);

    const error = await api.post('products', { barcode: '1' }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: conflict.message, errorCode: 'PRODUCT_ARCHIVED_EXISTS' });
    expect(error.data).toEqual(conflict);
  });

  it('requestForm (multipart): carrega errorCode e data', async () => {
    mockFetch(409, conflict);

    const error = await api.postForm('products/import', new FormData()).catch((e) => e);

    expect(error).toMatchObject({ status: 409, errorCode: 'PRODUCT_ARCHIVED_EXISTS' });
    expect(error.data).toEqual(conflict);
  });

  it('corpo sem errorCode (erro antigo ou 500): errorCode fica undefined', async () => {
    mockFetch(500, { statusCode: 500, message: 'Falhou' });

    const error = await api.get('products').catch((e) => e);

    expect(error).toMatchObject({ status: 500, message: 'Falhou' });
    expect(error.errorCode).toBeUndefined();
  });

  it('continua aceitando o construtor antigo (status, message)', () => {
    const error = new ApiError(404, 'Não achei');
    expect(error).toMatchObject({ status: 404, message: 'Não achei', data: null });
    expect(error.errorCode).toBeUndefined();
  });
});
```

Create `web-panel/src/lib/product-search.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { productSearchPath } from './product-search';

describe('productSearchPath', () => {
  it('sem busca: não manda q', () => {
    expect(productSearchPath({ q: '', status: 'active', page: 1, pageSize: 20 })).toBe(
      'products/search?status=active&page=1&pageSize=20',
    );
  });

  it('codifica caracteres especiais do texto (%, &, espaço) sem criar parâmetro extra', () => {
    const path = productSearchPath({ q: '100% a&b', status: 'all', page: 2, pageSize: 20 });
    const params = new URLSearchParams(path.split('?')[1]);

    expect(params.get('q')).toBe('100% a&b');
    expect([...params.keys()]).toEqual(['q', 'status', 'page', 'pageSize']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/api-client.spec.ts src/lib/product-search.spec.ts`
Expected: FAIL — `api-client.spec`: 3 testes sem `errorCode`/`data` (o 4º — construtor antigo — falha em
`data: null`); `product-search.spec`: `Failed to resolve import "./product-search"`.

- [ ] **Step 3: Implementar**

Modify `web-panel/src/lib/api-client.ts`:

Trocar a classe `ApiError` por:
```ts
export class ApiError extends Error {
  status: number;
  /** Código estável do backend (ex.: 'PRODUCT_ARCHIVED_EXISTS'), quando o corpo de erro trouxer um. */
  errorCode?: string;
  /** Corpo de erro inteiro (ex.: `productId` do conflito com produto arquivado). */
  data: unknown;

  constructor(status: number, message: string, data: unknown = null) {
    super(message);
    this.status = status;
    this.data = data;
    const code = (data as { errorCode?: unknown } | null)?.errorCode;
    this.errorCode = typeof code === 'string' ? code : undefined;
  }
}
```

Nos três pontos que lançam com o corpo lido (`request`, `requestForm`, `requestBlob`), passar `data`
como terceiro argumento:
```ts
      throw new ApiError(402, data?.message || 'Acesso suspenso. Assinatura inativa.', data);
    }
    throw new ApiError(response.status, data?.message || 'Erro inesperado.', data);
```
(nos dois primeiros) e
```ts
    throw new ApiError(response.status, data?.message || 'Erro ao gerar arquivo.', data);
```
(em `requestBlob`).

Modify `web-panel/src/lib/types.ts` — depois de `interface PriceHistoryEntry { … }`:
```ts
/** Filtro de status da busca de produtos (backend: GET /products/search?status=). */
export type ProductStatusFilter = 'active' | 'archived' | 'all';

/** Resposta de GET /products/search. */
export interface ProductSearchResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}
```

Create `web-panel/src/lib/product-search.ts`:
```ts
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
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npx vitest run src/lib/api-client.spec.ts src/lib/product-search.spec.ts
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add src/lib/api-client.ts src/lib/api-client.spec.ts src/lib/types.ts src/lib/product-search.ts src/lib/product-search.spec.ts
git commit -m "feat(web): ApiError com errorCode/data; tipos e URL da busca de produtos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS (4 + 2); 36 arquivos / 147; `tsc exit=0`.

---

### Task 3: Hook `useProductSearch`

**Files:**
- Create: `web-panel/src/app/(protected)/cadastros/produtos/use-product-search.ts`
- Create: `web-panel/src/app/(protected)/cadastros/produtos/use-product-search.spec.ts`

**Interfaces:**
- Consumes: `productSearchPath`, `PRODUCT_PAGE_SIZE`, `SEARCH_DEBOUNCE_MS`, `ProductSearchResult`,
  `ProductStatusFilter`, `ApiError`, `api.get`.
- Produces: `useProductSearch(): { search: string; setSearch(v: string): void; status: ProductStatusFilter;
  setStatus(s: ProductStatusFilter): void; page: number; setPage(p: number): void; items: Product[]; total:
  number; totalPages: number; loading: boolean; error: string | null; reload(): void }`.

- [ ] **Step 1: Testes (vão falhar)**

Create `web-panel/src/app/(protected)/cadastros/produtos/use-product-search.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api-client';
import type { Product, ProductSearchResult } from '@/lib/types';
import { useProductSearch } from './use-product-search';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn() },
}));

function product(id: string, name: string): Product {
  return { id, name, barcode: id, sku: null, unitPrice: 1, costPrice: 1, isActive: true };
}

function result(items: Product[], total = items.length, page = 1): ProductSearchResult {
  return { items, total, page, pageSize: 20 };
}

function calls(): string[] {
  return (api.get as Mock).mock.calls.map((call) => call[0] as string);
}

describe('useProductSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockResolvedValue(result([product('p-1', 'Arroz')]));
  });

  it('busca inicial: ativos, página 1, 20 por página', async () => {
    const { result: hook } = renderHook(() => useProductSearch());

    await waitFor(() => expect(hook.current.items).toHaveLength(1));
    expect(calls()).toEqual(['products/search?status=active&page=1&pageSize=20']);
    expect(hook.current).toMatchObject({ total: 1, totalPages: 1, loading: false, error: null });
  });

  it('debounce: digitar rápido faz UMA busca, com o texto final', async () => {
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));

    act(() => hook.current.setSearch('a'));
    act(() => hook.current.setSearch('ar'));
    act(() => hook.current.setSearch('arr'));

    await waitFor(() => expect(calls()).toContain('products/search?q=arr&status=active&page=1&pageSize=20'));
    expect(calls().filter((path) => path.includes('q='))).toEqual([
      'products/search?q=arr&status=active&page=1&pageSize=20',
    ]);
  });

  it('trocar o status volta para a página 1', async () => {
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));
    (api.get as Mock).mockResolvedValue(result([product('p-1', 'Arroz')], 60, 3));

    act(() => hook.current.setPage(3));
    await waitFor(() => expect(calls()).toContain('products/search?status=active&page=3&pageSize=20'));
    act(() => hook.current.setStatus('archived'));

    await waitFor(() => expect(calls()).toContain('products/search?status=archived&page=1&pageSize=20'));
    expect(hook.current.page).toBe(1);
  });

  it('resposta atrasada é descartada: vale o resultado da ÚLTIMA busca pedida', async () => {
    let resolveFirst: (value: ProductSearchResult) => void = () => undefined;
    (api.get as Mock).mockImplementation((path: string) =>
      path.includes('status=active')
        ? new Promise<ProductSearchResult>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(result([product('p-b', 'Arquivado')])),
    );
    const { result: hook } = renderHook(() => useProductSearch());

    act(() => hook.current.setStatus('archived'));
    await waitFor(() => expect(hook.current.items.map((p) => p.name)).toEqual(['Arquivado']));
    await act(async () => resolveFirst(result([product('p-a', 'Ativo atrasado')])));

    expect(hook.current.items.map((p) => p.name)).toEqual(['Arquivado']);
    expect(hook.current.loading).toBe(false);
  });

  it('página além do total (último item da página arquivado): volta para a última página que existe', async () => {
    (api.get as Mock).mockImplementation(async (path: string) =>
      path.includes('page=3') ? result([], 40, 3) : result([product('p-1', 'Arroz')], 40, 2),
    );
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));

    act(() => hook.current.setPage(3));

    await waitFor(() => expect(hook.current.page).toBe(2));
    expect(calls()).toContain('products/search?status=active&page=2&pageSize=20');
    expect(hook.current.totalPages).toBe(2);
  });

  it('reload repete a busca atual', async () => {
    const { result: hook } = renderHook(() => useProductSearch());
    await waitFor(() => expect(calls()).toHaveLength(1));

    act(() => hook.current.reload());

    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1]).toBe(calls()[0]);
  });

  it('erro da busca vira mensagem', async () => {
    (api.get as Mock).mockRejectedValue(new Error('rede'));
    const { result: hook } = renderHook(() => useProductSearch());

    await waitFor(() => expect(hook.current.error).toBe('Erro ao carregar produtos.'));
    expect(hook.current.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(protected)/cadastros/produtos/use-product-search.spec.ts"`
Expected: FAIL — `Failed to resolve import "./use-product-search"`.

- [ ] **Step 3: Implementar**

Create `web-panel/src/app/(protected)/cadastros/produtos/use-product-search.ts`:

```ts
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
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npx vitest run "src/app/(protected)/cadastros/produtos/use-product-search.spec.ts"
npx tsc --noEmit; echo "tsc exit=$?"
git add "src/app/(protected)/cadastros/produtos/use-product-search.ts" "src/app/(protected)/cadastros/produtos/use-product-search.spec.ts"
git commit -m "feat(web): hook de busca de produtos no servidor (debounce, status, página)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS — 7 testes; `tsc exit=0`. **Prova de sensibilidade** do teste de resposta atrasada:
remover temporariamente o `if (latestRequest.current !== requestId) return;` do `.then`, ver o teste
falhar, desfazer.

---

### Task 4: Página usa a busca do servidor — abas, paginação, Arquivar e Reativar

**Files:**
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx`

**Interfaces:**
- Consumes: `useProductSearch` (Task 3); `ProductStatusFilter` (Task 2); `Tabs`, `TabsList`, `TabsTrigger`
  de `@/components/ui/tabs`; `Badge` de `@/components/ui/badge`; ícones `Archive`, `ArchiveRestore` de
  `lucide-react`.
- Produces: nada consumido depois além da própria página (a Task 5 edita o formulário de cadastro).

- [ ] **Step 1: Ajustar o mock dos testes existentes e escrever os novos (vão falhar)**

Modify `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx`:

1. Trocar o bloco `vi.mock('@/lib/api-client', () => ({ … }));` inteiro por (o `ApiError` real, com
   `errorCode`/`data`):
```tsx
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() },
}));
```
2. Nos mocks de `api.get` dos testes existentes, trocar `if (path === 'products') return products;` (e a
   variante com `Promise.resolve(products)`) por:
```tsx
      if (path.startsWith('products/search')) return searchResult(products);
```
   (na variante que devolve Promise: `if (path.startsWith('products/search')) return Promise.resolve(searchResult(products));`).
3. Depois da constante `products`, acrescentar:
```tsx
function searchResult(items: typeof products, total = items.length) {
  return { items, total, page: 1, pageSize: 20 };
}
```
4. Ao fim do arquivo, um `describe` novo:
```tsx
describe('ProductsPage — busca no servidor, abas e ciclo de vida (etapa 1.3)', () => {
  const archived = { ...products[1], isActive: false };

  function searchCalls(): string[] {
    return (api.get as Mock).mock.calls.map((call) => call[0] as string).filter((p) => p.startsWith('products/search'));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.includes('status=archived')) return searchResult([archived]);
      if (path.startsWith('products/search')) return searchResult([products[0]], 45);
      throw new Error(`unexpected path: ${path}`);
    });
    (api.delete as Mock).mockResolvedValue(undefined);
    (api.patch as Mock).mockResolvedValue({});
  });

  it('carrega pela busca do servidor e pagina com o total do servidor', async () => {
    render(<ProductsPage />);

    expect(await screen.findByText('Arroz 5kg')).toBeInTheDocument();
    expect(searchCalls()[0]).toBe('products/search?status=active&page=1&pageSize=20');
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(searchCalls()).toContain('products/search?status=active&page=2&pageSize=20'));
  });

  it('abas: Arquivados troca o status da busca; Todos também', async () => {
    render(<ProductsPage />);
    await screen.findByText('Arroz 5kg');

    await userEvent.click(screen.getByRole('tab', { name: 'Arquivados' }));
    await waitFor(() => expect(searchCalls()).toContain('products/search?status=archived&page=1&pageSize=20'));
    await userEvent.click(screen.getByRole('tab', { name: 'Todos' }));
    await waitFor(() => expect(searchCalls()).toContain('products/search?status=all&page=1&pageSize=20'));
  });

  it('"Excluir" virou "Arquivar": o diálogo explica e arquivar chama DELETE e recarrega', async () => {
    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Arquivar Arroz 5kg' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/deixará de aparecer no app dos funcionários/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/histórico de perdas/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/reativá-lo depois/i)).toBeInTheDocument();
    const before = searchCalls().length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }));

    expect(api.delete).toHaveBeenCalledWith('products/p-a');
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(before));
    expect(screen.queryByRole('button', { name: /excluir/i })).not.toBeInTheDocument();
  });

  it('arquivados mostram o selo e a ação Reativar (PATCH …/restore), sem a ação Arquivar', async () => {
    render(<ProductsPage />);
    await screen.findByText('Arroz 5kg');
    await userEvent.click(screen.getByRole('tab', { name: 'Arquivados' }));

    expect(await screen.findByText('Arquivado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arquivar Feijão 1kg' })).not.toBeInTheDocument();
    const before = searchCalls().length;
    await userEvent.click(screen.getByRole('button', { name: 'Reativar Feijão 1kg' }));

    expect(api.patch).toHaveBeenCalledWith('products/p-b/restore');
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(before));
  });
});
```
   (acrescentar `waitFor` ao import de `@testing-library/react`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx"`
Expected: FAIL em todos — a página ainda chama `api.get('products')`, que o mock agora rejeita
(`unexpected path: products`).

- [ ] **Step 3: Implementar**

Modify `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`:

Imports — trocar as linhas
```tsx
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
```
por
```tsx
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Search } from 'lucide-react';
```
trocar `import type { ImportJob, PriceHistoryEntry, Product } from '@/lib/types';` por
```tsx
import type { ImportJob, PriceHistoryEntry, Product, ProductStatusFilter } from '@/lib/types';
```
trocar `import { Pagination, paginate } from '@/components/pagination';` por
```tsx
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProductSearch } from './use-product-search';
```

Remover a constante `const PAGE_SIZE = 20;` e, no componente, remover os estados `products`, `loading`,
`page` e `search`, a função `loadProducts`, o `useEffect(() => { loadProducts(); }, []);` e o
`filteredProducts` (`useMemo`). No lugar do primeiro `const [products, setProducts] = …`, colocar:
```tsx
  const productSearch = useProductSearch();
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
```
e renomear o estado `error`/`setError` restante para — ele deixa de existir: os erros de carga vêm de
`productSearch.error` e os de ação (arquivar/reativar) de `actionError`. Onde houver `setError(…)`
(em `handleDeleteConfirmed`), usar `setActionError(…)`.

Trocar toda chamada `await loadProducts();` (em `handleSubmit`, `handleEditSubmit`,
`handleDeleteConfirmed` e no `pollJobStatus` da importação) por `productSearch.reload();`.

Trocar `const [productToDelete, setProductToDelete] = useState<Product | null>(null);` e
`const [deleting, setDeleting] = useState(false);` por
```tsx
  const [productToArchive, setProductToArchive] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState(false);
```
e a função `handleDeleteConfirmed` inteira por:
```tsx
  async function handleArchiveConfirmed() {
    if (!productToArchive) return;
    setArchiving(true);
    setActionError(null);
    try {
      await api.delete(`products/${productToArchive.id}`);
      setProductToArchive(null);
      productSearch.reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Erro ao arquivar produto.');
    } finally {
      setArchiving(false);
    }
  }

  async function handleRestore(product: Product) {
    setRestoringId(product.id);
    setActionError(null);
    try {
      await api.patch(`products/${product.id}/restore`);
      productSearch.reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Erro ao reativar produto.');
    } finally {
      setRestoringId(null);
    }
  }
```

No JSX, trocar o bloco que vai de `{error && <p className="text-sm text-destructive">{error}</p>}` até o
fechamento do `<Card className="overflow-hidden py-0">` (inclusive o `<Pagination … />`) por:
```tsx
      {(productSearch.error || actionError) && (
        <p className="text-sm text-destructive">{actionError ?? productSearch.error}</p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={productSearch.status}
          onValueChange={(value) => productSearch.setStatus(value as ProductStatusFilter)}
        >
          <TabsList>
            <TabsTrigger value="active">Ativos</TabsTrigger>
            <TabsTrigger value="archived">Arquivados</TabsTrigger>
            <TabsTrigger value="all">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, código de barras ou SKU..."
            value={productSearch.search}
            onChange={(e) => productSearch.setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Código de barras</TableHead>
              <TableHead>Preço unitário</TableHead>
              <TableHead>Preço de custo</TableHead>
              <TableHead className="pr-6 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productSearch.loading && productSearch.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : productSearch.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {productSearch.search.trim()
                    ? 'Nenhum produto encontrado para essa busca.'
                    : productSearch.status === 'archived'
                      ? 'Nenhum produto arquivado.'
                      : 'Nenhum produto cadastrado ainda.'}
                </TableCell>
              </TableRow>
            ) : (
              productSearch.items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {product.name}
                      {!product.isActive && <Badge variant="secondary">Arquivado</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{product.barcode}</TableCell>
                  <TableCell>
                    {Number(product.unitPrice).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </TableCell>
                  <TableCell>
                    {Number(product.costPrice).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${product.name}`}
                        title="Editar"
                        onClick={() => openEdit(product)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {product.isActive ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Arquivar ${product.name}`}
                          title="Arquivar"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setProductToArchive(product)}
                        >
                          <Archive className="size-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reativar ${product.name}`}
                          title="Reativar"
                          disabled={restoringId === product.id}
                          onClick={() => handleRestore(product)}
                        >
                          <ArchiveRestore className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pagination
          page={productSearch.page}
          totalPages={productSearch.totalPages}
          onChange={productSearch.setPage}
        />
      </Card>
```

Trocar o diálogo de exclusão inteiro (o segundo `<Dialog open={!!productToDelete} …>…</Dialog>`) por:
```tsx
      <Dialog open={!!productToArchive} onOpenChange={(open) => !open && setProductToArchive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar produto</DialogTitle>
            <DialogDescription>
              <strong>{productToArchive?.name}</strong> deixará de aparecer no app dos funcionários. O
              histórico de perdas registradas com ele é mantido, e você pode reativá-lo depois na aba
              Arquivados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductToArchive(null)} disabled={archiving}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleArchiveConfirmed} disabled={archiving}>
              {archiving ? 'Arquivando...' : 'Arquivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

No texto do cabeçalho da página, trocar "Cadastro manual de produtos. Para cadastro em massa via
planilha, veja a nota abaixo." por "Cadastro manual de produtos. Para cadastro em massa via planilha,
use a importação abaixo." (não é exigido pelo spec — só se o texto antigo continuar no arquivo; se não
existir, ignorar).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx"`
Expected: PASS — 4 testes existentes (histórico/diálogo) + 4 novos = 8.

- [ ] **Step 5: Checar e commit**

```bash
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
grep -n "paginate\|filteredProducts\|loadProducts\|productToDelete" "src/app/(protected)/cadastros/produtos/page.tsx"
git add "src/app/(protected)/cadastros/produtos/page.tsx" "src/app/(protected)/cadastros/produtos/page.spec.tsx"
git commit -m "feat(web): produtos com busca no servidor, abas Ativos/Arquivados/Todos, arquivar e reativar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 37 arquivos / 158; `tsc exit=0`; o `grep` não imprime nada. (`paginate` continua exportado por
`components/pagination.tsx` — outras telas podem usá-lo; não remover.)

---

### Task 5: Cadastro de código arquivado oferece "Reativar e atualizar os dados"

**Files:**
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.tsx` (`handleSubmit` e o formulário de cadastro)
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx`

**Interfaces:**
- Consumes: `ApiError.errorCode`/`ApiError.data` (Task 2); `productSearch.reload` (Task 4).
- Produces: nada.

- [ ] **Step 1: Testes (vão falhar)**

Modify `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx` — ao fim do arquivo:

```tsx
describe('ProductsPage — cadastro de código de produto arquivado (etapa 1.3)', () => {
  const archivedConflict = new ApiError(
    409,
    'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
    {
      statusCode: 409,
      errorCode: 'PRODUCT_ARCHIVED_EXISTS',
      message: 'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
      productId: 'p-z',
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('products/search')) return searchResult([products[0]]);
      throw new Error(`unexpected path: ${path}`);
    });
  });

  async function fillAndSubmit() {
    render(<ProductsPage />);
    await screen.findByText('Arroz 5kg');
    const [barcodeInput, nameInput, priceInput] = screen.getAllByRole('textbox').slice(0, 2).concat(
      screen.getAllByRole('spinbutton').slice(0, 1),
    );
    await userEvent.type(barcodeInput, '999');
    await userEvent.type(nameInput, 'Macarrão');
    await userEvent.type(priceInput, '7.5');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar produto' }));
  }

  it('conflito com produto ARQUIVADO: mostra o aviso e "Reativar e atualizar os dados" reativa e grava o formulário', async () => {
    (api.post as Mock).mockRejectedValue(archivedConflict);
    (api.patch as Mock).mockResolvedValue({});
    await fillAndSubmit();

    expect(await screen.findByText(/existe um produto arquivado com este código/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reativar e atualizar os dados' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect((api.patch as Mock).mock.calls[0]).toEqual(['products/p-z/restore']);
    expect((api.patch as Mock).mock.calls[1]).toEqual([
      'products/p-z',
      { barcode: '999', name: 'Macarrão', unitPrice: 7.5, costPrice: undefined },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reativar e atualizar os dados' })).not.toBeInTheDocument(),
    );
  });

  it('conflito com produto ATIVO: só a mensagem, sem oferecer reativar', async () => {
    (api.post as Mock).mockRejectedValue(
      new ApiError(409, 'Já existe um produto com este código de barras.', {
        statusCode: 409,
        errorCode: 'PRODUCT_BARCODE_EXISTS',
        message: 'Já existe um produto com este código de barras.',
      }),
    );
    await fillAndSubmit();

    expect(await screen.findByText('Já existe um produto com este código de barras.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reativar e atualizar os dados' })).not.toBeInTheDocument();
  });

  it('falha no PATCH depois do restore: mostra o erro, mantém o formulário e recarrega a lista', async () => {
    (api.post as Mock).mockRejectedValue(archivedConflict);
    (api.patch as Mock)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError(400, 'name must be longer than or equal to 2 characters'));
    await fillAndSubmit();
    const searchesBefore = (api.get as Mock).mock.calls.length;

    await userEvent.click(await screen.findByRole('button', { name: 'Reativar e atualizar os dados' }));

    expect(await screen.findByText(/produto foi reativado, mas os dados não foram atualizados/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Macarrão')).toBeInTheDocument();
    await waitFor(() => expect((api.get as Mock).mock.calls.length).toBeGreaterThan(searchesBefore));
  });
});
```
(acrescentar `ApiError` ao import de `@/lib/api-client` no topo do arquivo, se ainda não estiver.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx"`
Expected: FAIL no 1º e no 3º teste novos (não existe o botão "Reativar e atualizar os dados"); o 2º pode
passar já agora (a mensagem já aparece) — ele protege contra oferecer reativar para produto ativo.

- [ ] **Step 3: Implementar**

Modify `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`:

Estado — depois de `const [submitting, setSubmitting] = useState(false);`:
```tsx
  // Cadastro de um código que pertence a um produto ARQUIVADO (409 PRODUCT_ARCHIVED_EXISTS): em vez de
  // um beco sem saída, oferece reativar aquele produto e gravar nele os dados do formulário (F2).
  const [archivedConflictId, setArchivedConflictId] = useState<string | null>(null);
  const [restoringConflict, setRestoringConflict] = useState(false);
```

Em `handleSubmit`: logo depois de `setFormError(null);` acrescentar `setArchivedConflictId(null);`; e no
`catch`, trocar
```tsx
      setFormError(e instanceof ApiError ? e.message : 'Erro ao cadastrar produto.');
```
por
```tsx
      setFormError(e instanceof ApiError ? e.message : 'Erro ao cadastrar produto.');
      if (e instanceof ApiError && e.errorCode === 'PRODUCT_ARCHIVED_EXISTS') {
        const productId = (e.data as { productId?: unknown } | null)?.productId;
        if (typeof productId === 'string') setArchivedConflictId(productId);
      }
```

Nova função, depois de `handleSubmit`:
```tsx
  async function handleRestoreAndUpdate() {
    if (!archivedConflictId) return;
    setRestoringConflict(true);
    let restored = false;
    try {
      await api.patch(`products/${archivedConflictId}/restore`);
      restored = true;
      await api.patch(`products/${archivedConflictId}`, {
        barcode,
        name,
        unitPrice: unitPrice ? Number(unitPrice) : undefined,
        costPrice: costPrice ? Number(costPrice) : undefined,
      });
      setArchivedConflictId(null);
      setFormError(null);
      setBarcode('');
      setName('');
      setUnitPrice('');
      setCostPrice('');
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : 'Erro inesperado.';
      setFormError(
        restored
          ? `O produto foi reativado, mas os dados não foram atualizados: ${detail}`
          : `Não foi possível reativar o produto: ${detail}`,
      );
      if (restored) setArchivedConflictId(null);
    } finally {
      setRestoringConflict(false);
      if (restored) productSearch.reload();
    }
  }
```

No formulário de cadastro, trocar
```tsx
            {formError && <p className="text-sm text-destructive sm:col-span-4">{formError}</p>}
```
por
```tsx
            {formError && (
              <div className="space-y-2 sm:col-span-4">
                <p className="text-sm text-destructive">{formError}</p>
                {archivedConflictId && (
                  <Button type="button" variant="outline" onClick={handleRestoreAndUpdate} disabled={restoringConflict}>
                    {restoringConflict ? 'Reativando...' : 'Reativar e atualizar os dados'}
                  </Button>
                )}
              </div>
            )}
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx"
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add "src/app/(protected)/cadastros/produtos/page.tsx" "src/app/(protected)/cadastros/produtos/page.spec.tsx"
git commit -m "feat(web): cadastrar código de produto arquivado oferece reativar e atualizar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS — 11 testes no arquivo; 37 arquivos / 161; `tsc exit=0`.

---

### Task 6: Verificação no navegador e registro do andamento

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` (seção 5)
- Modify: `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10)

- [ ] **Step 1: Verificação visual** (backend e painel rodando — `preview_start` "backend" e "web-panel";
  o banco de desenvolvimento já tem todas as migrations desde a 1.2.4)

Como gerente (atalho de desenvolvimento do login), em Cadastros › Produtos:
1. Digitar parte de um nome na busca — a lista filtra depois de uma pausa (Network: uma chamada
   `products/search?q=…` por pausa, não por tecla).
2. Arquivar um produto de teste — some de "Ativos", aparece em "Arquivados" com o selo e "Reativar".
3. Com ele arquivado, cadastrar um produto com o MESMO código — aparece o aviso e o botão "Reativar e
   atualizar os dados"; clicar — ele volta para "Ativos" com os dados novos.
4. Conferir tema escuro/claro e largura de celular (375 px): abas, busca e tabela sem estourar a tela.
Deixar os dados como estavam (o produto de teste termina ativo, com o nome/preço originais — se foram
alterados, editar de volta). Capturar imagem como prova.

- [ ] **Step 2: Registrar**

Modify `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` — logo depois do parágrafo
"**Divisão da etapa (2026-09-23):** …" da seção 5, acrescentar:
```markdown
**Resultado da 1.3.2 (<data>):** Cadastros › Produtos busca e pagina no servidor (`useProductSearch`:
debounce de 300 ms, só a última busca é aplicada, volta à última página que existe), abas Ativos |
Arquivados | Todos, "Arquivar" (texto explica app/histórico/reativar), "Reativar" nos arquivados e
"Reativar e atualizar os dados" no conflito com arquivado; `ApiError` com `errorCode`/`data`; 409 da
edição também com `errorCode`. Etapa 1.3 concluída.
```
e, na seção 10 do mestre, a linha do SP1: status da 1.3.2 ("etapa 1.3 concluída"), link do plano,
baselines web/backend atualizados, "Próximo: etapa 1.4 (sync correto + migração do SQLite)".

- [ ] **Step 3: Commit**

```bash
cd /c/PROJETOS/SAAS
git add docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "docs: andamento do SP1 — sub-etapa 1.3.2 e etapa 1.3 concluídas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (5.2 e testes web de 5.3):** `products/search` com debounce 300 ms, `page`/`total` do
servidor, sem `filter`/`paginate` locais → Tasks 3 e 4; abas → Task 4; Reativar → Task 4; "Arquivar" com o
texto pedido → Task 4; aviso + "Reativar e atualizar os dados" (`restore` + `PATCH`) → Task 5; `ApiError`
com `errorCode`/`data` nos dois caminhos (e no `requestBlob`) → Task 2; `ProductSearchResult` → Task 2.
Testes web de 5.3: abas trocam `status` (Task 4), busca com debounce (Task 3), reativar chama `restore`
(Task 4), conflito de arquivado oferece a ação (Task 5), texto "Arquivar" (Task 4). Achado menor da revisão
da 1.3.1 (409 do `update`) → Task 1.

**Review Focus:** 1 e 2 → Task 3; 3 → Task 2; 4 e 5 → Task 5.

**Placeholders:** `<data>` na Task 6 é preenchido na execução.

**Consistência:** `ApiError(status, message, data?)` com `errorCode`/`data` (Task 2) usado igual nas
Tasks 4 e 5; `productSearchPath`/`PRODUCT_PAGE_SIZE`/`SEARCH_DEBOUNCE_MS` (Task 2) usados pelo hook
(Task 3); retorno do hook (Task 3) usado pela página com os mesmos nomes (`items`, `total`, `totalPages`,
`page`, `setPage`, `status`, `setStatus`, `search`, `setSearch`, `loading`, `error`, `reload`).

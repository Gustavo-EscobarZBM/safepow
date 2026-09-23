# SP1 · Sub-etapa 1.2.4 — Linha do tempo de preços no painel — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O diálogo "Editar produto" do painel mostra a linha do tempo de preços do produto (data, preço,
custo, quem alterou, origem), lida de `GET /products/:id/price-history` (sub-etapa 1.2.3).

**Architecture:** Um componente de apresentação `PriceHistoryTimeline` (recebe `entries/loading/error`,
sem chamar a API — testável como os demais componentes do painel) e a página de produtos buscando o
histórico ao abrir o diálogo, com proteção contra resposta atrasada de outro produto.

**Tech Stack:** Next.js 14 (App Router, `'use client'`), React 18, Tailwind, shadcn/ui, Vitest 2 + Testing
Library (jsdom).

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md),
seção 4.3 ("Diálogo de edição do produto ganha a linha do tempo de preços (lista simples: data, preço,
custo, quem alterou, origem). Nenhuma outra tela muda.") e 4.2 (contrato do endpoint).

## Global Constraints

- **Nenhuma outra tela muda** (spec 4.3). Só `cadastros/produtos/page.tsx` ganha o bloco no diálogo de
  edição; a busca/paginação no servidor é a etapa 1.3 (fora de escopo).
- **Backend não muda.** Contrato consumido (spec 4.2 / `PriceHistoryEntry` do backend): `id`, `unitPrice`
  (number), `costPrice` (number), `validFrom` (ISO string no JSON), `source` (`'manual' | 'import' | 'bulk' |
  'retro_fix' | 'erp' | 'approval' | 'backfill'`), `changedByUserId`, `changedByName` (`string | null`);
  no máximo 100 linhas, mais recente primeiro.
- Formatação monetária sempre por `formatBRL` de `src/lib/format.ts` (padrão do painel).
- Textos da interface em português.
- Comandos a partir de `C:\PROJETOS\SAAS\web-panel`. Testes: `npx vitest run <arquivo>`; suíte: `npm test`;
  tipos: `npx tsc --noEmit`.
- **Baseline (confirme antes da Task 1):** `npm test` = 32 arquivos / 129 testes; `npx tsc --noEmit` limpo.
- **Commits:** branch `feat/cadastros-sp1-etapa-1-2-4` a partir de `main`, um commit por tarefa, mensagem
  terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Merge/push só com confirmação.
- **Verificação visual no navegador (Task 3, último passo) exige o banco de desenvolvimento com as
  migrations 10000–13000 aplicadas** — decisão do usuário. Sem ela, o passo é pulado e isso é reportado.

## Review Focus

1. **Troca rápida de produto:** abrir o produto A e, antes de o histórico chegar, abrir o B — a resposta
   atrasada de A não pode aparecer no diálogo de B. → Task 3, teste "resposta atrasada de outro produto".
2. **Falha ao carregar o histórico** (rede, 500, backend sem a migration): mostra a mensagem, mas o
   formulário continua editável e salvável. → Task 3, teste "erro no histórico não bloqueia a edição".
3. **Produto só com a linha do backfill** (todo produto antigo): aparece como "Registro inicial", não como
   um valor técnico cru. → Task 2, teste de rótulos de origem.
4. **Quem alterou desconhecido** (importação, usuário excluído, backfill — `changedByName = null`): a
   linha não mostra "por null"/"por undefined". → Task 2, teste "sem autor".
5. **Histórico longo (100 linhas):** o diálogo não cresce além da tela — a lista rola dentro de uma área
   de altura limitada. → Task 2, teste que confere a classe de rolagem; e a verificação visual da Task 3.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `web-panel/src/lib/types.ts` | modificar | `PriceChangeSource`, `PriceHistoryEntry` |
| `web-panel/src/lib/format.ts` | modificar | `formatDateTimeBR` |
| `web-panel/src/lib/format.spec.ts` | modificar | teste de `formatDateTimeBR` |
| `web-panel/src/components/price-history-timeline.tsx` | criar | lista (apresentação pura) |
| `web-panel/src/components/price-history-timeline.spec.tsx` | criar | testes do componente |
| `web-panel/src/app/(protected)/cadastros/produtos/page.tsx` | modificar | busca ao abrir o diálogo, renderiza a lista |
| `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx` | criar | testes da integração na página |

---

### Task 1: Tipos e `formatDateTimeBR`

**Files:**
- Modify: `web-panel/src/lib/types.ts` (depois de `interface Product`)
- Modify: `web-panel/src/lib/format.ts`
- Test: `web-panel/src/lib/format.spec.ts`

**Interfaces:**
- Produces: `type PriceChangeSource`, `interface PriceHistoryEntry` (em `@/lib/types`);
  `formatDateTimeBR(iso: string): string` (em `@/lib/format`) — data e hora locais, `dd/mm/aaaa hh:mm`.

- [ ] **Step 1: Branch e baseline**

```bash
cd /c/PROJETOS/SAAS && git checkout main && git checkout -b feat/cadastros-sp1-etapa-1-2-4
cd web-panel && npm test 2>&1 | tail -4
npx tsc --noEmit; echo "tsc exit=$?"
```
Expected: 32 arquivos / 129 testes; `tsc exit=0`.

- [ ] **Step 2: Escrever o teste (vai falhar)**

Modify `web-panel/src/lib/format.spec.ts` — acrescentar ao import `formatDateTimeBR` e, no fim do arquivo:

```ts
describe('formatDateTimeBR', () => {
  it('formata data e hora locais como dd/mm/aaaa hh:mm', () => {
    // Construída no fuso local, para o teste não depender do fuso da máquina.
    const local = new Date(2026, 8, 10, 14, 5);
    expect(formatDateTimeBR(local.toISOString())).toMatch(/^10\/09\/2026,? 14:05$/);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/format.spec.ts`
Expected: FAIL — `formatDateTimeBR` não é exportado (`is not a function`).

- [ ] **Step 4: Implementar**

Modify `web-panel/src/lib/format.ts` — acrescentar ao fim:

```ts
export function formatDateTimeBR(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

Modify `web-panel/src/lib/types.ts` — depois de `interface Product { … }`:

```ts
/** Origem de uma mudança de preço (backend: product_price_history.source). */
export type PriceChangeSource = 'manual' | 'import' | 'bulk' | 'retro_fix' | 'erp' | 'approval' | 'backfill';

/** Linha de GET /products/:id/price-history (mais recente primeiro, no máximo 100). */
export interface PriceHistoryEntry {
  id: string;
  unitPrice: number;
  costPrice: number;
  validFrom: string;
  source: PriceChangeSource;
  changedByUserId: string | null;
  changedByName: string | null;
}
```

- [ ] **Step 5: Rodar e ver passar; commit**

```bash
npx vitest run src/lib/format.spec.ts
npx tsc --noEmit; echo "tsc exit=$?"
git add src/lib/format.ts src/lib/format.spec.ts src/lib/types.ts
git commit -m "feat(web): tipos do histórico de preço e formatDateTimeBR" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; `tsc exit=0`.

---

### Task 2: Componente `PriceHistoryTimeline`

**Files:**
- Create: `web-panel/src/components/price-history-timeline.tsx`
- Test: `web-panel/src/components/price-history-timeline.spec.tsx`

**Interfaces:**
- Consumes: `PriceHistoryEntry`, `PriceChangeSource` (Task 1), `formatBRL`, `formatDateTimeBR`.
- Produces: `PriceHistoryTimeline({ entries, loading, error }: { entries: PriceHistoryEntry[]; loading:
  boolean; error: string | null })` e `PRICE_SOURCE_LABELS: Record<PriceChangeSource, string>`.

- [ ] **Step 1: Escrever os testes (vão falhar)**

Create `web-panel/src/components/price-history-timeline.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriceHistoryTimeline } from './price-history-timeline';
import type { PriceHistoryEntry } from '@/lib/types';

function entry(overrides: Partial<PriceHistoryEntry> = {}): PriceHistoryEntry {
  return {
    id: 'h-1',
    unitPrice: 12,
    costPrice: 6,
    validFrom: '2026-09-10T17:05:00.000Z',
    source: 'manual',
    changedByUserId: 'u-1',
    changedByName: 'Gerente Maria',
    ...overrides,
  };
}

describe('PriceHistoryTimeline', () => {
  it('mostra o estado de carregamento', () => {
    render(<PriceHistoryTimeline entries={[]} loading error={null} />);
    expect(screen.getByText(/carregando histórico de preços/i)).toBeInTheDocument();
  });

  it('mostra o erro', () => {
    render(<PriceHistoryTimeline entries={[]} loading={false} error="Falhou" />);
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('mostra a mensagem de vazio', () => {
    render(<PriceHistoryTimeline entries={[]} loading={false} error={null} />);
    expect(screen.getByText(/nenhuma mudança de preço registrada/i)).toBeInTheDocument();
  });

  it('lista preço, custo, origem e quem alterou, na ordem recebida', () => {
    render(
      <PriceHistoryTimeline
        entries={[entry(), entry({ id: 'h-2', unitPrice: 10, costPrice: 5, source: 'import', changedByName: null })]}
        loading={false}
        error={null}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/12,00/);
    expect(items[0]).toHaveTextContent(/custo R\$\s6,00/i);
    expect(items[0]).toHaveTextContent('Manual');
    expect(items[0]).toHaveTextContent('por Gerente Maria');
    expect(items[1]).toHaveTextContent(/10,00/);
    expect(items[1]).toHaveTextContent('Importação');
  });

  it('sem autor conhecido não escreve "por null" nem "por undefined"', () => {
    render(<PriceHistoryTimeline entries={[entry({ changedByName: null })]} loading={false} error={null} />);
    expect(screen.getByRole('listitem')).not.toHaveTextContent(/por /);
  });

  it('a linha do backfill aparece como "Registro inicial"', () => {
    render(
      <PriceHistoryTimeline entries={[entry({ source: 'backfill', changedByName: null })]} loading={false} error={null} />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Registro inicial');
  });

  it('a lista rola dentro de uma área de altura limitada (histórico de até 100 linhas)', () => {
    render(<PriceHistoryTimeline entries={[entry()]} loading={false} error={null} />);
    expect(screen.getByRole('list', { name: /histórico de preços/i })).toHaveClass('max-h-56', 'overflow-y-auto');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/price-history-timeline.spec.tsx`
Expected: FAIL — `Failed to resolve import "./price-history-timeline"`.

- [ ] **Step 3: Implementar**

Create `web-panel/src/components/price-history-timeline.tsx`:

```tsx
import { formatBRL, formatDateTimeBR } from '@/lib/format';
import type { PriceChangeSource, PriceHistoryEntry } from '@/lib/types';

export const PRICE_SOURCE_LABELS: Record<PriceChangeSource, string> = {
  manual: 'Manual',
  import: 'Importação',
  bulk: 'Edição em massa',
  retro_fix: 'Correção retroativa',
  erp: 'ERP',
  approval: 'Aprovação',
  backfill: 'Registro inicial',
};

interface PriceHistoryTimelineProps {
  entries: PriceHistoryEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Linha do tempo de preços do produto (SP1, sub-etapa 1.2.4). Só apresentação: quem busca o histórico
 * é a página. As perdas guardam o preço vigente quando ocorreram — esta lista mostra de onde vem esse
 * valor.
 */
export function PriceHistoryTimeline({ entries, loading, error }: PriceHistoryTimelineProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Histórico de preços</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando histórico de preços...</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma mudança de preço registrada.</p>
      ) : (
        <ol aria-label="Histórico de preços" className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{formatBRL(entry.unitPrice)}</span>
                <span className="text-xs text-muted-foreground">{formatDateTimeBR(entry.validFrom)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Custo {formatBRL(entry.costPrice)} · {PRICE_SOURCE_LABELS[entry.source] ?? entry.source}
                {entry.changedByName ? ` · por ${entry.changedByName}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar; commit**

```bash
npx vitest run src/components/price-history-timeline.spec.tsx
npx tsc --noEmit; echo "tsc exit=$?"
git add src/components/price-history-timeline.tsx src/components/price-history-timeline.spec.tsx
git commit -m "feat(web): componente da linha do tempo de preços" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS — 7 testes; `tsc exit=0`.

---

### Task 3: Diálogo de edição mostra o histórico

**Files:**
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`
- Test: `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx`

**Interfaces:**
- Consumes: `PriceHistoryTimeline` (Task 2), `PriceHistoryEntry` (Task 1), `api.get` de `@/lib/api-client`.
- Produces: nada consumido por outra tarefa.

- [ ] **Step 1: Escrever os testes (vão falhar)**

Create `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsPage from './page';
import { api, ApiError } from '@/lib/api-client';
import type { PriceHistoryEntry } from '@/lib/types';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const products = [
  { id: 'p-a', barcode: '111', sku: null, name: 'Arroz 5kg', unitPrice: '12.00', costPrice: '6.00', isActive: true },
  { id: 'p-b', barcode: '222', sku: null, name: 'Feijão 1kg', unitPrice: '8.00', costPrice: '4.00', isActive: true },
];

function history(unitPrice: number, id: string): PriceHistoryEntry[] {
  return [
    {
      id,
      unitPrice,
      costPrice: 1,
      validFrom: '2026-09-10T17:05:00.000Z',
      source: 'manual',
      changedByUserId: null,
      changedByName: null,
    },
  ];
}

describe('ProductsPage — linha do tempo de preços no diálogo de edição', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ao abrir a edição, busca e mostra o histórico daquele produto', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path === 'products') return products;
      if (path === 'products/p-a/price-history') return history(12, 'h-a');
      throw new Error(`unexpected path: ${path}`);
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));

    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByRole('list', { name: /histórico de preços/i });
    expect(list).toHaveTextContent(/12,00/);
    expect(api.get).toHaveBeenCalledWith('products/p-a/price-history');
  });

  it('erro no histórico não bloqueia a edição: mostra a mensagem e o botão de salvar continua ativo', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path === 'products') return products;
      throw new ApiError(500, 'Histórico indisponível.');
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Histórico indisponível.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Salvar alterações' })).toBeEnabled();
  });

  it('resposta atrasada de outro produto não aparece no diálogo do produto aberto depois', async () => {
    let resolveA: (value: PriceHistoryEntry[]) => void = () => undefined;
    (api.get as Mock).mockImplementation((path: string) => {
      if (path === 'products') return Promise.resolve(products);
      if (path === 'products/p-a/price-history') {
        return new Promise<PriceHistoryEntry[]>((resolve) => {
          resolveA = resolve;
        });
      }
      if (path === 'products/p-b/price-history') return Promise.resolve(history(8, 'h-b'));
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Feijão 1kg' }));

    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByRole('list', { name: /histórico de preços/i });
    expect(list).toHaveTextContent(/8,00/);

    resolveA(history(99, 'h-a')); // chega depois, com o diálogo do Feijão aberto
    await new Promise((r) => setTimeout(r, 0));

    expect(within(dialog).getByRole('list', { name: /histórico de preços/i })).not.toHaveTextContent(/99,00/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx"`
Expected: FAIL nos 3 testes — nenhuma lista "Histórico de preços" no diálogo (o 1º e o 3º falham no
`findByRole('list', …)`; o 2º no `findByText('Histórico indisponível.')`).

- [ ] **Step 3: Implementar**

Modify `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`:

Imports — trocar `import type { ImportJob, Product } from '@/lib/types';` por:
```tsx
import type { ImportJob, PriceHistoryEntry, Product } from '@/lib/types';
import { PriceHistoryTimeline } from '@/components/price-history-timeline';
```

Estado — depois de `const [editSubmitting, setEditSubmitting] = useState(false);`:
```tsx
  const [priceHistory, setPriceHistory] = useState<{
    entries: PriceHistoryEntry[];
    loading: boolean;
    error: string | null;
  }>({ entries: [], loading: false, error: null });
  // Produto cujo histórico está sendo exibido: uma resposta que chegue depois de o gerente trocar de
  // produto é descartada, senão o diálogo do produto B mostraria os preços do A.
  const priceHistoryProductRef = useRef<string | null>(null);
```

Função — antes de `function openEdit`:
```tsx
  async function loadPriceHistory(productId: string) {
    priceHistoryProductRef.current = productId;
    setPriceHistory({ entries: [], loading: true, error: null });
    try {
      const entries = await api.get<PriceHistoryEntry[]>(`products/${productId}/price-history`);
      if (priceHistoryProductRef.current !== productId) return;
      setPriceHistory({ entries, loading: false, error: null });
    } catch (e) {
      if (priceHistoryProductRef.current !== productId) return;
      setPriceHistory({
        entries: [],
        loading: false,
        error: e instanceof ApiError ? e.message : 'Erro ao carregar o histórico de preços.',
      });
    }
  }
```

Em `openEdit`, depois de `setEditError(null);`:
```tsx
    void loadPriceHistory(product.id);
```

No diálogo de edição, entre o `</div>` que fecha a grade de campos e `{editError && …}`:
```tsx
            <PriceHistoryTimeline {...priceHistory} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx"`
Expected: PASS — 3 testes.

- [ ] **Step 5: Suíte, tipos e commit**

```bash
npm test 2>&1 | tail -4
npx tsc --noEmit; echo "tsc exit=$?"
git add "src/app/(protected)/cadastros/produtos/page.tsx" "src/app/(protected)/cadastros/produtos/page.spec.tsx"
git commit -m "feat(web): diálogo de edição do produto mostra a linha do tempo de preços" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 35 arquivos / 140 testes (baseline + 1 + 7 + 3); `tsc exit=0`.

- [ ] **Step 6: Verificação visual (só se o banco de desenvolvimento já tiver as migrations 10000–13000)**

Com backend (`preview_start` "backend", porta 3000) e painel (`preview_start` "web-panel", porta 3001):
entrar como gerente (atalho de desenvolvimento da tela de login), abrir Cadastros › Produtos, editar um
produto — conferir a lista com a linha "Registro inicial"; mudar o preço, salvar, reabrir — conferir a
linha nova no topo com "Manual · por <nome do gerente>"; conferir no tema escuro e numa largura de celular
(375 px) que a lista rola dentro do diálogo. Capturar uma imagem como prova. Sem as migrations, pular este
passo e registrar no relatório.

- [ ] **Step 7: Registrar o andamento**

Modify `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` — no fim da seção 4.3:
```markdown
**Resultado (sub-etapa 1.2.4, <data>):** `PriceHistoryTimeline` no diálogo "Editar produto"
(`cadastros/produtos/page.tsx`), buscando `GET /products/:id/price-history` ao abrir, com descarte de
resposta atrasada de outro produto. Etapa 1.2 (valor congelado + histórico de preço) concluída.
```
e, na seção 10 do mestre, a linha do SP1: status da 1.2.4 e link do plano. Commit:
```bash
cd /c/PROJETOS/SAAS && git add docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "docs: andamento do SP1 — sub-etapa 1.2.4" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (4.3):** data, preço, custo, quem alterou, origem → Task 2 (componente) e Task 3
(diálogo). "Nenhuma outra tela muda" → só `produtos/page.tsx` é tocado.

**Review Focus:** cada item tem teste na tarefa dona (1 e 2 → Task 3; 3, 4 e 5 → Task 2), e o 5 também
na verificação visual.

**Placeholders:** `<data>`/`<nome do gerente>` são preenchidos na execução — não são lacunas.

**Consistência:** `PriceHistoryEntry`/`PriceChangeSource` (Task 1) batem com o contrato do backend
(`products.service.ts`, sub-etapa 1.2.3), com `validFrom` como string (JSON). `PriceHistoryTimeline` e
`PRICE_SOURCE_LABELS` (Task 2) usados com a mesma assinatura na Task 3.

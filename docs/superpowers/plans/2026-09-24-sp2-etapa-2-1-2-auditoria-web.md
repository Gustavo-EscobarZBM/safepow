# SP2 — Sub-etapa 2.1.2: Auditoria no painel web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a trilha de auditoria (já gravada pelo backend da 2.1.1) no painel: página **Auditoria**
(filtros, tabela legível, exportar CSV) e a gaveta **Histórico** (`HistoryDrawer`) em Produtos, Perdas e
Usuários.

**Architecture:** Um módulo puro `src/lib/audit.ts` concentra rótulos (entidade, ação, origem, campos) e a
formatação de valores/alterações — o "mapa único" do spec. `HistoryDrawer` é um componente autossuficiente
(busca `GET /audit?entityType=&entityId=` sozinho) para ser reaproveitado pelo motor da 2.4. A página
`/auditoria` usa `GET /audit` paginado e `GET /audit/export` (blob) pelo proxy `/api/backend`. Nenhuma
mudança no backend.

**Tech Stack:** Next.js 14 (app router, `'use client'`), React 18, Tailwind 3, componentes shadcn/radix
existentes (`Dialog`, `Table`, `Button`, `Card`, `Input`, `Label`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md` (seção 2.6; testes
na 2.7). Backend entregue na 2.1.1 (mesma seção, "Resultado da 2.1.1").

## Global Constraints

- API (gerente): `GET /audit?entityType=&entityId=&actorUserId=&action=&from=&to=&page=&pageSize=` →
  `{ items, total, page, pageSize }`, mais recente primeiro; `pageSize` máximo 100; parâmetro desconhecido ⇒ 400.
- `GET /audit/export?…mesmos filtros…` → CSV (UTF-8 com BOM, `;`); acima de 50 mil linhas ⇒ 400 com mensagem.
- Item: `{ id, createdAt, actorUserId, actorName, actorRole, entityType, entityId, entityLabel, action,
  changes: {field, from, to}[], summary, source, reason, requestId, ip }`.
- `entityType` ∈ product, loss_reason, loss_location, loss, user, company, company_revenue, import_job,
  session, change_request. `action` ∈ create, update, archive, restore, delete, import, login, login_failed,
  approve, reject, retro_fix, request, justify. `source` ∈ web, mobile, import, system.
- Senha: o backend grava `{ field: 'password', from: null, to: 'alterada' }` — nunca o hash.
- Alterações em `create` vêm como `from: null`; em `delete`, `to: null`.
- Resumo de importação: `summary = { status: 'completed'|'failed', totalRows, created, updated, reactivated, errors }`.
- Página e gaveta só para gerente (o backend devolve 403 para os demais; o `middleware.ts` do painel já barra
  funcionário fora da lista branca).
- Todo o texto da interface em português; valores em R$ com `formatBRL`; datas com `formatDateTimeBR`.
- Comando de testes do painel: `npm test` em `web-panel/` (baseline: 37 arquivos / 162 testes).

## Review Focus

1. **Valor numérico vindo como texto** (`"10.50"`) ou número (`10.5`) num campo de dinheiro ⇒ sempre
   "R$ 10,50". → Task 1, teste "moeda aceita número e texto".
2. **Evento sem alterações nem resumo** (login, falha de login) ⇒ a linha mostra "—", sem quebrar. → Task 1
   (`describeEntry`) e Task 3 (linha de login na tabela).
3. **Campo que o painel ainda não conhece** (coluna nova no backend) ⇒ aparece com o nome cru, sem quebrar.
   → Task 1, teste "campo desconhecido".
4. **Filtro "até" com só a data** ⇒ inclui o dia inteiro no fuso do navegador (o backend compara `<=` com o
   instante). → Task 1 (`buildAuditQuery`) e Task 3.
5. **Gaveta reaberta para outro registro** antes da resposta anterior chegar ⇒ nunca mostra o histórico do
   registro errado. → Task 2, teste "resposta atrasada de outro registro é descartada".

---

## Estrutura de arquivos

- Create `web-panel/src/lib/audit.ts` — tipos de filtro, rótulos, formatação, `buildAuditQuery`.
- Create `web-panel/src/lib/audit.spec.ts`
- Modify `web-panel/src/lib/types.ts` — `AuditLogEntry`, `AuditPage`.
- Create `web-panel/src/components/history-drawer.tsx`, `history-drawer.spec.tsx`
- Create `web-panel/src/app/(protected)/auditoria/page.tsx`, `page.spec.tsx`
- Modify `web-panel/src/components/nav.tsx`, `nav.spec.tsx` — link "Auditoria".
- Modify `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`, `page.spec.tsx` — botão no diálogo de edição.
- Modify `web-panel/src/app/(protected)/losses/losses-client.tsx`; Create `losses-client.spec.tsx`.
- Modify `web-panel/src/app/(protected)/users/page.tsx`; Create `users/page.spec.tsx`.
- Modify docs (Task 5).

---

### Task 1: Mapa único de rótulos e formatação (`lib/audit.ts`)

**Files:**
- Create: `web-panel/src/lib/audit.ts`, `web-panel/src/lib/audit.spec.ts`
- Modify: `web-panel/src/lib/types.ts` (ao fim)

**Interfaces:**
- Produces: tipos `AuditLogEntry`, `AuditPage` (em `types.ts`); de `audit.ts`: `ENTITY_LABELS`,
  `ACTION_LABELS`, `SOURCE_LABELS`, `FIELD_LABELS`, `fieldLabel(field: string): string`,
  `formatAuditValue(field: string, value: unknown): string`, `describeChange(change: AuditChange, action:
  string): string`, `describeEntry(entry: AuditLogEntry): string[]`, `interface AuditFilters { entityType?:
  string; action?: string; from?: string /* yyyy-mm-dd */; to?: string /* yyyy-mm-dd */; entityId?: string;
  page?: number; pageSize?: number }`, `buildAuditQuery(filters: AuditFilters): string` (devolve `''` ou
  `'?a=b&…'`).

- [ ] **Step 1: Tipos e testes (vão falhar)**

Acrescentar ao fim de `web-panel/src/lib/types.ts`:
```ts
/** Uma alteração de campo registrada pela auditoria (SP2). */
export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** Linha da trilha de auditoria (backend: GET /audit). */
export interface AuditLogEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  action: string;
  changes: AuditChange[];
  summary: Record<string, unknown> | null;
  source: string;
  reason: string | null;
  requestId: string | null;
  ip: string | null;
}

export interface AuditPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}
```

Create `web-panel/src/lib/audit.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildAuditQuery, describeChange, describeEntry, fieldLabel, formatAuditValue } from './audit';
import type { AuditLogEntry } from './types';

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 'a1',
    createdAt: '2026-09-24T12:00:00.000Z',
    actorUserId: null,
    actorName: null,
    actorRole: null,
    entityType: 'product',
    entityId: 'p1',
    entityLabel: 'Arroz',
    action: 'update',
    changes: [],
    summary: null,
    source: 'web',
    reason: null,
    requestId: null,
    ip: null,
    ...overrides,
  };
}

describe('rótulos da auditoria', () => {
  it('traduz campos conhecidos e deixa o nome cru para campo desconhecido', () => {
    expect(fieldLabel('unitPrice')).toBe('Preço unitário');
    expect(fieldLabel('campoNovoDoBackend')).toBe('campoNovoDoBackend');
  });
});

describe('formatAuditValue', () => {
  it('moeda aceita número e texto', () => {
    expect(formatAuditValue('unitPrice', 10.5)).toBe(formatAuditValue('unitPrice', '10.50'));
    expect(formatAuditValue('unitPrice', 10.5)).toMatch(/R\$\s?10,50/);
  });

  it('booleano vira Sim/Não; vazio vira —; papel e situação são traduzidos', () => {
    expect(formatAuditValue('isActive', false)).toBe('Não');
    expect(formatAuditValue('isActive', true)).toBe('Sim');
    expect(formatAuditValue('name', null)).toBe('—');
    expect(formatAuditValue('role', 'manager')).toBe('Gerente');
    expect(formatAuditValue('status', 'blocked')).toBe('Bloqueada');
  });
});

describe('describeChange', () => {
  it('alteração: "Rótulo: de → para"', () => {
    expect(describeChange({ field: 'unitPrice', from: 10, to: 12 }, 'update')).toMatch(
      /^Preço unitário: R\$\s?10,00 → R\$\s?12,00$/,
    );
  });

  it('criação mostra só o valor novo; exclusão só o antigo', () => {
    expect(describeChange({ field: 'name', from: null, to: 'Arroz' }, 'create')).toBe('Nome: Arroz');
    expect(describeChange({ field: 'name', from: 'Arroz', to: null }, 'delete')).toBe('Nome: Arroz');
  });

  it('senha nunca mostra valor; referências a outro registro dizem só "alterado"', () => {
    expect(describeChange({ field: 'password', from: null, to: 'alterada' }, 'update')).toBe('Senha alterada');
    expect(describeChange({ field: 'reasonId', from: 'x', to: 'y' }, 'update')).toBe('Motivo: alterado');
  });
});

describe('describeEntry', () => {
  it('evento sem alterações nem resumo (login) ⇒ lista vazia', () => {
    expect(describeEntry(entry({ entityType: 'session', action: 'login' }))).toEqual([]);
  });

  it('resumo de importação vira uma frase', () => {
    const lines = describeEntry(
      entry({
        entityType: 'import_job',
        action: 'import',
        summary: { status: 'completed', totalRows: 3, created: 1, updated: 1, reactivated: 1, errors: 0 },
      }),
    );
    expect(lines).toEqual(['3 linhas: 1 criado(s), 1 atualizado(s), 1 reativado(s), 0 com erro']);
  });

  it('importação que falhou avisa', () => {
    const [line] = describeEntry(
      entry({
        entityType: 'import_job',
        action: 'import',
        summary: { status: 'failed', totalRows: 0, created: 0, updated: 0, reactivated: 0, errors: 0 },
      }),
    );
    expect(line).toMatch(/^Falhou/);
  });

  it('alterações viram uma linha cada', () => {
    const lines = describeEntry(
      entry({ changes: [{ field: 'name', from: 'A', to: 'B' }, { field: 'isActive', from: true, to: false }] }),
    );
    expect(lines).toEqual(['Nome: A → B', 'Ativo: Sim → Não']);
  });
});

describe('buildAuditQuery', () => {
  it('sem filtros ⇒ string vazia; ignora campos vazios', () => {
    expect(buildAuditQuery({})).toBe('');
    expect(buildAuditQuery({ entityType: '', action: undefined })).toBe('');
  });

  it('"de"/"até" com só a data cobrem o dia inteiro no fuso local', () => {
    const query = new URLSearchParams(buildAuditQuery({ from: '2026-09-24', to: '2026-09-24' }).slice(1));
    expect(query.get('from')).toBe(new Date(2026, 8, 24, 0, 0, 0, 0).toISOString());
    expect(query.get('to')).toBe(new Date(2026, 8, 24, 23, 59, 59, 999).toISOString());
  });

  it('inclui entidade, ação, registro e paginação', () => {
    const query = new URLSearchParams(
      buildAuditQuery({ entityType: 'product', action: 'update', entityId: 'p1', page: 2, pageSize: 20 }).slice(1),
    );
    expect(Object.fromEntries(query)).toEqual({
      entityType: 'product',
      action: 'update',
      entityId: 'p1',
      page: '2',
      pageSize: '20',
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/PROJETOS/SAAS/web-panel && npx vitest run src/lib/audit.spec.ts`
Expected: FAIL — `Failed to resolve import "./audit"`.

- [ ] **Step 3: Implementar**

Create `web-panel/src/lib/audit.ts`:
```ts
import { formatBRL, formatDateTimeBR } from './format';
import type { AuditChange, AuditLogEntry } from './types';

/**
 * Mapa único de rótulos da auditoria (SP2, 2.1.2). Página Auditoria e gaveta Histórico leem daqui; o motor
 * de cadastros (2.4) também. Chave desconhecida (coluna nova no backend) aparece crua em vez de quebrar.
 */
export const ENTITY_LABELS: Record<string, string> = {
  product: 'Produto',
  loss_reason: 'Motivo',
  loss_location: 'Local',
  loss: 'Perda',
  user: 'Usuário',
  company: 'Empresa',
  company_revenue: 'Faturamento',
  import_job: 'Importação',
  session: 'Acesso',
  change_request: 'Solicitação',
};

export const ACTION_LABELS: Record<string, string> = {
  create: 'Criação',
  update: 'Alteração',
  archive: 'Arquivamento',
  restore: 'Reativação',
  delete: 'Exclusão',
  import: 'Importação',
  login: 'Login',
  login_failed: 'Falha de login',
  approve: 'Aprovação',
  reject: 'Rejeição',
  retro_fix: 'Correção retroativa',
  request: 'Solicitação',
  justify: 'Justificativa',
};

export const SOURCE_LABELS: Record<string, string> = {
  web: 'Painel',
  mobile: 'App',
  import: 'Importação',
  system: 'Sistema',
};

export const ROLE_LABELS: Record<string, string> = {
  manager: 'Gerente',
  employee: 'Funcionário',
  master_admin: 'Administrador Master',
};

const COMPANY_STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  past_due: 'Vencida',
  blocked: 'Bloqueada',
  canceled: 'Cancelada',
};

export const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  barcode: 'Código de barras',
  sku: 'SKU',
  unitPrice: 'Preço unitário',
  costPrice: 'Custo',
  isActive: 'Ativo',
  quantity: 'Quantidade',
  description: 'Descrição',
  productId: 'Produto',
  reasonId: 'Motivo',
  locationId: 'Local',
  occurredAt: 'Data da perda',
  imageUrl: 'Foto',
  requiresVerification: 'Exige conferência',
  verifiedAt: 'Conferida em',
  verifiedByUserId: 'Conferida por',
  reportedByUserId: 'Registrada por',
  unitPriceAtLoss: 'Preço na data da perda',
  unitCostAtLoss: 'Custo na data da perda',
  valuationSource: 'Origem do valor',
  clientGeneratedId: 'Identificador do app',
  source: 'Origem',
  email: 'E-mail',
  role: 'Papel',
  password: 'Senha',
  cnpj: 'CNPJ',
  status: 'Situação',
  planTier: 'Plano',
  lastManualUnlockAt: 'Desbloqueio manual',
  lossVerificationEnabled: 'Conferência de perdas',
  lossVerifierId: 'Conferente',
  year: 'Ano',
  month: 'Mês',
  revenueAmount: 'Faturamento',
};

const MONEY_FIELDS = new Set(['unitPrice', 'costPrice', 'unitPriceAtLoss', 'unitCostAtLoss', 'revenueAmount']);
const DATE_FIELDS = new Set(['occurredAt', 'verifiedAt', 'lastManualUnlockAt']);
// Referências a outro registro: o id cru não diz nada a quem lê; a linha diz só que mudou.
const REFERENCE_FIELDS = new Set([
  'productId',
  'reasonId',
  'locationId',
  'verifiedByUserId',
  'reportedByUserId',
  'lossVerifierId',
  'clientGeneratedId',
  'imageUrl',
]);

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (MONEY_FIELDS.has(field) && !Number.isNaN(Number(value))) return formatBRL(Number(value));
  if (DATE_FIELDS.has(field) && typeof value === 'string') return formatDateTimeBR(value);
  if (field === 'role') return ROLE_LABELS[String(value)] ?? String(value);
  if (field === 'status') return COMPANY_STATUS_LABELS[String(value)] ?? String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function describeChange(change: AuditChange, action: string): string {
  const label = fieldLabel(change.field);
  if (change.field === 'password') return 'Senha alterada';
  if (REFERENCE_FIELDS.has(change.field)) return `${label}: alterado`;
  if (action === 'create') return `${label}: ${formatAuditValue(change.field, change.to)}`;
  if (action === 'delete') return `${label}: ${formatAuditValue(change.field, change.from)}`;
  return `${label}: ${formatAuditValue(change.field, change.from)} → ${formatAuditValue(change.field, change.to)}`;
}

function describeImportSummary(summary: Record<string, unknown>): string {
  const n = (key: string) => Number(summary[key] ?? 0);
  const counts = `${n('created')} criado(s), ${n('updated')} atualizado(s), ${n('reactivated')} reativado(s), ${n('errors')} com erro`;
  if (summary.status === 'failed') return `Falhou — ${counts}`;
  return `${n('totalRows')} linhas: ${counts}`;
}

/** Linhas legíveis de um registro: uma por alteração, ou o resumo da importação. Vazio para login. */
export function describeEntry(entry: AuditLogEntry): string[] {
  if (entry.summary && entry.entityType === 'import_job') return [describeImportSummary(entry.summary)];
  return entry.changes.map((change) => describeChange(change, entry.action));
}

export interface AuditFilters {
  entityType?: string;
  action?: string;
  /** yyyy-mm-dd (input type="date"); vira o início do dia no fuso do navegador. */
  from?: string;
  /** yyyy-mm-dd; vira o FIM do dia no fuso do navegador — o backend compara `createdAt <= to`. */
  to?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

function localDayBoundary(date: string, endOfDay: boolean): string {
  const [year, month, day] = date.split('-').map(Number);
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
    : new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

export function buildAuditQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.action) params.set('action', filters.action);
  if (filters.entityId) params.set('entityId', filters.entityId);
  if (filters.from) params.set('from', localDayBoundary(filters.from, false));
  if (filters.to) params.set('to', localDayBoundary(filters.to, true));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();
  return query ? `?${query}` : '';
}
```

- [ ] **Step 4: Rodar e commit**

```bash
cd /c/PROJETOS/SAAS/web-panel
npx vitest run src/lib/audit.spec.ts
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add src/lib/audit.ts src/lib/audit.spec.ts src/lib/types.ts
git commit -m "feat(web): mapa único de rótulos e formatação da auditoria" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 13; suíte 38 arquivos / 175 testes; `tsc exit=0`.

---

### Task 2: Gaveta `HistoryDrawer`

**Files:**
- Create: `web-panel/src/components/history-drawer.tsx`, `web-panel/src/components/history-drawer.spec.tsx`

**Interfaces:**
- Consumes: `describeEntry`, `ACTION_LABELS`, `SOURCE_LABELS`, `buildAuditQuery` (Task 1); `AuditPage` (Task 1).
- Produces: `HistoryDrawer({ entityType: string; entityId: string | null; title: string; open: boolean;
  onOpenChange: (open: boolean) => void })` — busca `audit?entityType=…&entityId=…&pageSize=100` ao abrir.
  Lista com `aria-label="Histórico de alterações"`.

- [ ] **Step 1: Testes (vão falhar)**

Create `web-panel/src/components/history-drawer.spec.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoryDrawer } from './history-drawer';
import { api, ApiError } from '@/lib/api-client';
import type { AuditLogEntry } from '@/lib/types';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn() },
}));

function item(id: string, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    createdAt: '2026-09-24T12:00:00.000Z',
    actorUserId: 'u1',
    actorName: 'Ana Gerente',
    actorRole: 'manager',
    entityType: 'product',
    entityId: 'p1',
    entityLabel: 'Arroz',
    action: 'update',
    changes: [{ field: 'unitPrice', from: 10, to: 12 }],
    summary: null,
    source: 'web',
    reason: null,
    requestId: null,
    ip: null,
    ...overrides,
  };
}

function page(items: AuditLogEntry[]) {
  return { items, total: items.length, page: 1, pageSize: 100 };
}

describe('HistoryDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ao abrir, busca o histórico daquele registro e mostra quem, de onde e o quê', async () => {
    (api.get as Mock).mockResolvedValue(page([item('a1')]));

    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />);

    const list = await screen.findByRole('list', { name: 'Histórico de alterações' });
    expect(list).toHaveTextContent('Ana Gerente');
    expect(list).toHaveTextContent('Painel');
    expect(list).toHaveTextContent('Alteração');
    expect(list).toHaveTextContent(/Preço unitário: R\$\s?10,00 → R\$\s?12,00/);
    expect(api.get).toHaveBeenCalledWith('audit?entityType=product&entityId=p1&pageSize=100');
  });

  it('fechado não busca nada', () => {
    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open={false} onOpenChange={() => {}} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('sem registros mostra aviso; erro da API aparece', async () => {
    (api.get as Mock).mockResolvedValueOnce(page([]));
    const { unmount } = render(
      <HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />,
    );
    expect(await screen.findByText('Nenhuma alteração registrada.')).toBeInTheDocument();
    unmount();

    (api.get as Mock).mockRejectedValueOnce(new ApiError(403, 'Acesso negado.'));
    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />);
    expect(await screen.findByText('Acesso negado.')).toBeInTheDocument();
  });

  it('autor ausente (sistema/importação) aparece como "Sistema"', async () => {
    (api.get as Mock).mockResolvedValue(page([item('a1', { actorName: null, source: 'system' })]));
    render(<HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />);
    const list = await screen.findByRole('list', { name: 'Histórico de alterações' });
    expect(list).toHaveTextContent('Sistema');
  });

  it('resposta atrasada de outro registro é descartada', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    (api.get as Mock)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(page([item('b1', { entityId: 'p2', changes: [{ field: 'name', from: 'B', to: 'C' }] })]));

    const { rerender } = render(
      <HistoryDrawer entityType="product" entityId="p1" title="Arroz" open onOpenChange={() => {}} />,
    );
    rerender(<HistoryDrawer entityType="product" entityId="p2" title="Feijão" open onOpenChange={() => {}} />);
    const list = await screen.findByRole('list', { name: 'Histórico de alterações' });
    resolveFirst(page([item('a1', { changes: [{ field: 'name', from: 'X', to: 'ERRADO' }] })]));

    await waitFor(() => expect(list).toHaveTextContent('Nome: B → C'));
    expect(screen.queryByText(/ERRADO/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/history-drawer.spec.tsx`
Expected: FAIL — `Failed to resolve import "./history-drawer"`.

- [ ] **Step 3: Implementar**

Create `web-panel/src/components/history-drawer.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { ACTION_LABELS, SOURCE_LABELS, buildAuditQuery, describeEntry } from '@/lib/audit';
import { formatDateTimeBR } from '@/lib/format';
import type { AuditLogEntry, AuditPage } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const HISTORY_PAGE_SIZE = 100;

interface HistoryDrawerProps {
  entityType: string;
  entityId: string | null;
  /** Nome do registro, mostrado no cabeçalho ("Histórico — Arroz 5kg"). */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Gaveta "Histórico" (SP2, 2.1.2): quem mudou o quê, quando e de onde, para UM registro. Busca sozinha
 * (GET /audit filtrado pela entidade) para ser reaproveitada por qualquer cadastro — inclusive o motor da 2.4.
 * Mostra as 100 mudanças mais recentes; o histórico completo fica na página Auditoria.
 */
export function HistoryDrawer({ entityType, entityId, title, open, onOpenChange }: HistoryDrawerProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chave da busca em andamento: resposta de um registro anterior (gaveta reaberta para outro) é descartada.
  const requestKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !entityId) return;
    const key = `${entityType}:${entityId}`;
    requestKey.current = key;
    setEntries([]);
    setError(null);
    setLoading(true);
    api
      .get<AuditPage>(`audit${buildAuditQuery({ entityType, entityId, pageSize: HISTORY_PAGE_SIZE })}`)
      .then((page) => {
        if (requestKey.current === key) setEntries(page.items);
      })
      .catch((e: unknown) => {
        if (requestKey.current === key) {
          setError(e instanceof ApiError ? e.message : 'Erro ao carregar o histórico.');
        }
      })
      .finally(() => {
        if (requestKey.current === key) setLoading(false);
      });
  }, [open, entityType, entityId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!top-0 !right-0 !left-auto !translate-x-0 !translate-y-0 flex h-dvh w-full flex-col rounded-none sm:!max-w-md">
        <DialogHeader>
          <DialogTitle>Histórico — {title}</DialogTitle>
          <DialogDescription>Quem alterou, quando, de onde e o que mudou.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando histórico...</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
        ) : (
          <ol aria-label="Histórico de alterações" className="flex-1 space-y-2 overflow-y-auto pr-1">
            {entries.map((entry) => {
              const lines = describeEntry(entry);
              return (
                <li key={entry.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTimeBR(entry.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.actorName ?? 'Sistema'} · {SOURCE_LABELS[entry.source] ?? entry.source}
                  </p>
                  {lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {lines.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {entry.reason && <p className="mt-1 text-xs italic">Justificativa: {entry.reason}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Rodar e commit**

```bash
npx vitest run src/components/history-drawer.spec.tsx
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add src/components/history-drawer.tsx src/components/history-drawer.spec.tsx
git commit -m "feat(web): gaveta Histórico (HistoryDrawer) com a trilha de auditoria de um registro" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS 5; suíte 39 / 180; `tsc exit=0`.

---

### Task 3: Página Auditoria e link no menu

**Files:**
- Create: `web-panel/src/app/(protected)/auditoria/page.tsx`, `web-panel/src/app/(protected)/auditoria/page.spec.tsx`
- Modify: `web-panel/src/components/nav.tsx`, `web-panel/src/components/nav.spec.tsx`

**Interfaces:**
- Consumes: Task 1 (`buildAuditQuery`, `describeEntry`, rótulos, `AuditPage`), `api.get`/`api.getBlob`,
  `Pagination` (`src/components/pagination.tsx`: `{ page, totalPages, onChange }`).
- Produces: rota `/auditoria` (só gerente no menu).

- [ ] **Step 1: Testes (vão falhar)**

Create `web-panel/src/app/(protected)/auditoria/page.spec.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuditPage from './page';
import { api, ApiError } from '@/lib/api-client';
import type { AuditLogEntry } from '@/lib/types';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), getBlob: vi.fn() },
}));

function item(id: string, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    createdAt: '2026-09-24T12:00:00.000Z',
    actorUserId: 'u1',
    actorName: 'Ana Gerente',
    actorRole: 'manager',
    entityType: 'product',
    entityId: 'p1',
    entityLabel: 'Arroz 5kg',
    action: 'update',
    changes: [{ field: 'unitPrice', from: 10, to: 12 }],
    summary: null,
    source: 'web',
    reason: null,
    requestId: null,
    ip: null,
    ...overrides,
  };
}

describe('AuditPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista com pessoa, origem, ação, entidade legível e alterações', async () => {
    (api.get as Mock).mockResolvedValue({
      items: [item('a1'), item('a2', { entityType: 'session', action: 'login', entityLabel: 'Ana Gerente', changes: [], source: 'mobile' })],
      total: 2,
      page: 1,
      pageSize: 50,
    });

    render(<AuditPage />);

    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Ana Gerente');
    expect(rows[1]).toHaveTextContent('Painel');
    expect(rows[1]).toHaveTextContent('Alteração');
    expect(rows[1]).toHaveTextContent('Produto');
    expect(rows[1]).toHaveTextContent('Arroz 5kg');
    expect(rows[1]).toHaveTextContent(/Preço unitário: R\$\s?10,00 → R\$\s?12,00/);
    expect(rows[2]).toHaveTextContent('Login');
    expect(rows[2]).toHaveTextContent('App');
    expect(rows[2]).toHaveTextContent('—');
    expect(api.get).toHaveBeenCalledWith('audit?page=1&pageSize=50');
  });

  it('filtros de entidade, ação e período entram na busca (período cobre o dia inteiro)', async () => {
    (api.get as Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    render(<AuditPage />);
    await screen.findByText('Nenhum registro encontrado.');

    await userEvent.selectOptions(screen.getByLabelText('Entidade'), 'product');
    await userEvent.selectOptions(screen.getByLabelText('Ação'), 'update');
    await userEvent.type(screen.getByLabelText('De'), '2026-09-01');
    await userEvent.type(screen.getByLabelText('Até'), '2026-09-24');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => {
      const last = (api.get as Mock).mock.calls.at(-1)![0] as string;
      const query = new URLSearchParams(last.split('?')[1]);
      expect(query.get('entityType')).toBe('product');
      expect(query.get('action')).toBe('update');
      expect(query.get('from')).toBe(new Date(2026, 8, 1).toISOString());
      expect(query.get('to')).toBe(new Date(2026, 8, 24, 23, 59, 59, 999).toISOString());
      expect(query.get('page')).toBe('1');
    });
  });

  it('exportar CSV baixa com os mesmos filtros (sem paginação)', async () => {
    (api.get as Mock).mockResolvedValue({ items: [item('a1')], total: 1, page: 1, pageSize: 50 });
    (api.getBlob as Mock).mockResolvedValue(new Blob(['x']));
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    render(<AuditPage />);
    await screen.findAllByRole('row');

    await userEvent.selectOptions(screen.getByLabelText('Entidade'), 'user');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    await waitFor(() => expect(api.getBlob).toHaveBeenCalledWith('audit/export?entityType=user'));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('erro da API (ex.: exportação grande demais) aparece na tela', async () => {
    (api.get as Mock).mockResolvedValue({ items: [item('a1')], total: 1, page: 1, pageSize: 50 });
    (api.getBlob as Mock).mockRejectedValue(new ApiError(400, 'A exportação tem 60000 linhas (máximo 50000).'));
    render(<AuditPage />);
    await screen.findAllByRole('row');

    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(await screen.findByText(/máximo 50000/)).toBeInTheDocument();
  });

  it('paginação pede a próxima página', async () => {
    (api.get as Mock).mockResolvedValue({ items: [item('a1')], total: 120, page: 1, pageSize: 50 });
    render(<AuditPage />);
    await screen.findAllByRole('row');

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('audit?page=2&pageSize=50'));
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();
  });
});
```

Modify `web-panel/src/components/nav.spec.tsx` — acrescentar dentro do `describe` existente:
```tsx
  it('mostra "Auditoria" para o gerente e não para o funcionário', () => {
    const { unmount } = render(<Nav user={{ id: '1', name: 'Ana', role: 'manager', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /Auditoria/ })).toHaveAttribute('href', '/auditoria');
    unmount();
    render(<Nav user={{ id: '2', name: 'João', role: 'employee', companyId: 'c1' }} />);
    expect(screen.queryByRole('link', { name: /Auditoria/ })).not.toBeInTheDocument();
  });
```
(conferir que `screen` já está importado de `@testing-library/react` no arquivo; se não, acrescentar.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(protected)/auditoria/page.spec.tsx" src/components/nav.spec.tsx`
Expected: página FAIL (`Failed to resolve import "./page"`); nav: o teste novo FAIL (sem link).

- [ ] **Step 3: Implementar**

Modify `web-panel/src/components/nav.tsx`:
- no import de `lucide-react`, acrescentar `History,`.
- em `MANAGER_LINKS`, depois de `{ href: '/users', label: 'Usuários', icon: Users },`:
```tsx
  { href: '/auditoria', label: 'Auditoria', icon: History },
```

Create `web-panel/src/app/(protected)/auditoria/page.tsx`:
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  SOURCE_LABELS,
  buildAuditQuery,
  describeEntry,
  type AuditFilters,
} from '@/lib/audit';
import { formatDateTimeBR } from '@/lib/format';
import type { AuditLogEntry, AuditPage as AuditPageData } from '@/lib/types';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE_SIZE = 50;
// Ações que fazem sentido filtrar hoje (as de aprovação chegam na 2.2).
const FILTER_ACTIONS = ['create', 'update', 'archive', 'restore', 'delete', 'import', 'login', 'login_failed'];
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring';

type FilterForm = Pick<AuditFilters, 'entityType' | 'action' | 'from' | 'to'>;
const EMPTY_FILTERS: FilterForm = { entityType: '', action: '', from: '', to: '' };

/** Página Auditoria (SP2, 2.1.2): trilha completa da empresa, com filtros e exportação CSV. */
export default function AuditPage() {
  const [form, setForm] = useState<FilterForm>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<FilterForm>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AuditPageData>(`audit${buildAuditQuery({ ...filters, page, pageSize: PAGE_SIZE })}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleFilter(e: FormEvent) {
    e.preventDefault();
    setFilters(form);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.getBlob(`audit/export${buildAuditQuery(filters)}`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'auditoria.csv';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao exportar a auditoria.');
    } finally {
      setExporting(false);
    }
  }

  const items: AuditLogEntry[] = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Auditoria</h1>
          <p className="text-sm text-muted-foreground">
            Quem alterou o quê, quando e de onde — produtos, perdas, cadastros, usuários, acessos e importações.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Gerando...' : 'Exportar CSV'}
        </Button>
      </div>

      <Card className="p-4">
        <form onSubmit={handleFilter} className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="audit-entity">Entidade</Label>
            <select
              id="audit-entity"
              className={SELECT_CLASS}
              value={form.entityType}
              onChange={(e) => setForm({ ...form, entityType: e.target.value })}
            >
              <option value="">Todas</option>
              {Object.entries(ENTITY_LABELS)
                .filter(([key]) => key !== 'change_request')
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-action">Ação</Label>
            <select
              id="audit-action"
              className={SELECT_CLASS}
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
            >
              <option value="">Todas</option>
              {FILTER_ACTIONS.map((key) => (
                <option key={key} value={key}>
                  {ACTION_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-from">De</Label>
            <Input id="audit-from" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to">Até</Label>
            <Input id="audit-to" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </div>
          <Button type="submit">Filtrar</Button>
        </form>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/hora</TableHead>
              <TableHead>Pessoa</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead>Alterações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </TableCell>
              </TableRow>
            ) : (
              items.map((entry) => {
                const lines = describeEntry(entry);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTimeBR(entry.createdAt)}</TableCell>
                    <TableCell>{entry.actorName ?? 'Sistema'}</TableCell>
                    <TableCell>{SOURCE_LABELS[entry.source] ?? entry.source}</TableCell>
                    <TableCell>{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{ENTITY_LABELS[entry.entityType] ?? entry.entityType}</span>
                      {entry.entityLabel ? ` · ${entry.entityLabel}` : ''}
                    </TableCell>
                    <TableCell className="max-w-md text-xs">
                      {lines.length === 0 ? '—' : lines.map((line, index) => <div key={index}>{line}</div>)}
                      {entry.reason && <div className="italic">Justificativa: {entry.reason}</div>}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e commit**

```bash
npx vitest run "src/app/(protected)/auditoria/page.spec.tsx" src/components/nav.spec.tsx
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add "src/app/(protected)/auditoria" src/components/nav.tsx src/components/nav.spec.tsx
git commit -m "feat(web): página Auditoria com filtros, paginação e exportação CSV" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; suíte 40 / 186; `tsc exit=0`.

---

### Task 4: Gaveta Histórico em Produtos, Perdas e Usuários

**Files:**
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`, `.../produtos/page.spec.tsx`
- Modify: `web-panel/src/app/(protected)/losses/losses-client.tsx`; Create `.../losses/losses-client.spec.tsx`
- Modify: `web-panel/src/app/(protected)/users/page.tsx`; Create `.../users/page.spec.tsx`

**Interfaces:**
- Consumes: `HistoryDrawer` (Task 2).

- [ ] **Step 1: Testes (vão falhar)**

Em `web-panel/src/app/(protected)/cadastros/produtos/page.spec.tsx`, no `describe` da linha do tempo, acrescentar:
```tsx
  it('no diálogo de edição, "Histórico de alterações" abre a gaveta daquele produto', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('products/search')) return searchResult(products);
      if (path === 'products/p-a/price-history') return history(12, 'h-a');
      if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      throw new Error(`unexpected path: ${path}`);
    });

    render(<ProductsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Arroz 5kg' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico de alterações' }));

    expect(await screen.findByText('Histórico — Arroz 5kg')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('audit?entityType=product&entityId=p-a&pageSize=100');
  });
```

Create `web-panel/src/app/(protected)/losses/losses-client.spec.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LossesClient } from './losses-client';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), getBlob: vi.fn(), postForm: vi.fn() },
}));

const loss = {
  id: 'l-1',
  productId: 'p-1',
  product: { name: 'Arroz 5kg' },
  quantity: '2',
  reason: { name: 'Quebra/Avaria' },
  location: { name: 'Depósito/Estoque' },
  description: null,
  reportedBy: { name: 'João' },
  imageUrl: null,
  occurredAt: '2026-09-24T12:00:00.000Z',
};

describe('LossesClient — gaveta Histórico', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gerente abre o histórico da perda pela linha', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      if (path.startsWith('losses')) return [loss];
      return []; // products, loss-reasons, loss-locations: arrays
    });

    render(<LossesClient role="manager" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico da perda' }));

    expect(api.get).toHaveBeenCalledWith('audit?entityType=loss&entityId=l-1&pageSize=100');
  });
});
```
(Formato conferido ao escrever o plano: `loadLosses` usa `api.get<Loss[]>('losses…')` — array — e as listas
auxiliares `products`, `loss-reasons`, `loss-locations` também são arrays.)

Create `web-panel/src/app/(protected)/users/page.spec.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './page';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('UsersPage — gaveta Histórico', () => {
  beforeEach(() => vi.clearAllMocks());

  it('abre o histórico do usuário pela linha', async () => {
    (api.get as Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('audit?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      return [{ id: 'u-1', name: 'Ana', email: 'ana@x.com', role: 'employee', isActive: true }];
    });

    render(<UsersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico de Ana' }));

    expect(await screen.findByText('Histórico — Ana')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('audit?entityType=user&entityId=u-1&pageSize=100');
  });
});
```
(Formato conferido: `UsersPage` usa `api.get<TenantUser[]>('users')` — array.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx" "src/app/(protected)/losses/losses-client.spec.tsx" "src/app/(protected)/users/page.spec.tsx"`
Expected: os 3 testes novos FAIL (botão não encontrado); os antigos de produtos continuam PASS.

- [ ] **Step 3: Implementar**

`produtos/page.tsx`:
- imports: `import { HistoryDrawer } from '@/components/history-drawer';`
- estado: `const [historyOpen, setHistoryOpen] = useState(false);`
- logo depois de `<PriceHistoryTimeline {...priceHistory} />`:
```tsx
            <Button type="button" variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
              Histórico de alterações
            </Button>
```
- logo depois do `</Dialog>` do diálogo de edição (o que contém o `PriceHistoryTimeline`):
```tsx
      <HistoryDrawer
        entityType="product"
        entityId={productToEdit?.id ?? null}
        title={productToEdit?.name ?? ''}
        open={historyOpen && !!productToEdit}
        onOpenChange={setHistoryOpen}
      />
```

`losses/losses-client.tsx`:
- imports: `History` no import de `lucide-react`; `import { HistoryDrawer } from '@/components/history-drawer';`
- estado: `const [lossForHistory, setLossForHistory] = useState<Loss | null>(null);` (usar o tipo das linhas da
  tabela — o mesmo de `lossToEdit`).
- dentro de `<div className="flex justify-end gap-1">` da linha (bloco `canManage`), ANTES do botão "Editar perda":
```tsx
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Histórico da perda"
                              title="Histórico"
                              onClick={() => setLossForHistory(loss)}
                            >
                              <History className="size-4" />
                            </Button>
```
- ao fim do JSX, junto dos outros diálogos:
```tsx
      <HistoryDrawer
        entityType="loss"
        entityId={lossForHistory?.id ?? null}
        title={lossForHistory ? `Perda de ${lossForHistory.product?.name ?? 'produto'}` : ''}
        open={!!lossForHistory}
        onOpenChange={(open) => !open && setLossForHistory(null)}
      />
```

`users/page.tsx`:
- imports: `History` no import de `lucide-react`; `import { HistoryDrawer } from '@/components/history-drawer';`
- estado: `const [userForHistory, setUserForHistory] = useState<TenantUser | null>(null);`
- na linha, ANTES do botão `Editar ${user.name}`:
```tsx
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Histórico de ${user.name}`}
                        title="Histórico"
                        onClick={() => setUserForHistory(user)}
                      >
                        <History className="size-4" />
                      </Button>
```
- ao fim do JSX:
```tsx
      <HistoryDrawer
        entityType="user"
        entityId={userForHistory?.id ?? null}
        title={userForHistory?.name ?? ''}
        open={!!userForHistory}
        onOpenChange={(open) => !open && setUserForHistory(null)}
      />
```

- [ ] **Step 4: Rodar e commit**

```bash
npx vitest run "src/app/(protected)/cadastros/produtos/page.spec.tsx" "src/app/(protected)/losses/losses-client.spec.tsx" "src/app/(protected)/users/page.spec.tsx"
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
git add "src/app/(protected)/cadastros/produtos" "src/app/(protected)/losses" "src/app/(protected)/users"
git commit -m "feat(web): gaveta Histórico em Produtos, Perdas e Usuários" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS; suíte 42 / 189; `tsc exit=0`.

---

### Task 5: Verificação no navegador e registro do andamento

**Files:** Modify `docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md` (fim da seção
2, depois da "Revisão final da 2.1.1") e `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md`
(seção 10, linha do SP2).

- [ ] **Step 1: Verificar no navegador** (backend e painel rodando; banco de desenvolvimento já tem 15000/16000)

Com `preview_start` (`backend`, `web-panel`), entrar como gerente (`gerente.demo@safepow.com` / `demo1234`):
1. Menu → **Auditoria**: a tabela lista os logins e a alteração de preço da "bolacha" (10 → 10,50 → 10) com
   "Gerente Demo", "Painel", "Alteração", "Produto · bolacha", "Preço unitário: R$ 10,00 → R$ 10,50".
2. Filtrar por Entidade = Produto e período de hoje ⇒ só produto. **Exportar CSV** ⇒ baixa `auditoria.csv`
   (conferir em `read_network_requests` a resposta 200 de `audit/export`).
3. Produtos → editar "bolacha" → **Histórico de alterações** ⇒ a gaveta mostra as duas alterações de preço.
4. Perdas → ícone de histórico numa linha ⇒ gaveta abre (pode estar vazia: perdas antigas são anteriores à
   auditoria — mensagem "Nenhuma alteração registrada.").
5. Usuários → ícone de histórico ⇒ gaveta abre.
6. Celular (`resize_window` mobile): a gaveta ocupa a tela e rola por dentro.
7. `read_console_messages` sem erros novos (o aviso de hidratação do tema já existia).

- [ ] **Step 2: Registrar**

No spec do SP2, depois do parágrafo "**Revisão final da 2.1.1:** …":
```markdown
**Resultado da 2.1.2 (<data>):** página **Auditoria** (`/auditoria`, menu do gerente: filtros de entidade,
ação e período — o período cobre dias inteiros no fuso do navegador —, paginação de 50, exportar CSV) e
gaveta **Histórico** (`HistoryDrawer`, busca sozinha `GET /audit?entityType=&entityId=`, 100 mais recentes)
em Produtos (diálogo de edição), Perdas (linha) e Usuários (linha). Rótulos e formatação num mapa único
(`web-panel/src/lib/audit.ts`). Sem mudança no backend. **Etapa 2.1 concluída.**
```
Na seção 10 do mestre, linha do SP2: acrescentar "2.1.2 (web) executada em <data>" e o link do plano; baseline
do painel.

- [ ] **Step 3: Checagem final e commit**

```bash
cd /c/PROJETOS/SAAS/web-panel
npm test 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit; echo "tsc exit=$?"
cd /c/PROJETOS/SAAS && git add docs/superpowers/specs/2026-09-24-sp2-auditoria-aprovacoes-motor-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "docs: andamento do SP2 — sub-etapa 2.1.2" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec (2.6, parte web):** página Auditoria com data/hora, pessoa, origem, ação, entidade
legível, alterações resumidas, filtros e exportar CSV → Task 3; `HistoryDrawer` reaproveitável, em produto
(diálogo de edição, ao lado da linha do tempo), perda (linha) e usuários → Tasks 2 e 4; mapa único de rótulos
→ Task 1. Testes da 2.7 (web): mapa de rótulos, página e gaveta (vitest) → Tasks 1–4. Menor da 2.1.1 "`to` só
com data exclui o dia" → resolvido no painel (`buildAuditQuery`). Menor "expor `X-Request-Id` no CORS" →
desnecessário: o painel fala com o backend pelo proxy `/api/backend` e não mostra o id.

**Placeholders:** `<data>` na Task 5 é preenchido na execução.

**Consistência:** `buildAuditQuery({ entityType, entityId, pageSize: 100 })` gera
`?entityType=…&entityId=…&pageSize=100` (ordem de inserção: entityType, action, entityId, from, to, page,
pageSize) — bate com as asserções das Tasks 2 e 4; na página, `{ page, pageSize }` gera `?page=1&pageSize=50`
(Task 3). `AuditPage` (tipo) é importado como `AuditPageData` na página para não colidir com o componente.

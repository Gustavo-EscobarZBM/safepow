# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the manager Dashboard (`web-panel/src/app/(protected)/dashboard/page.tsx`) and its supporting sidebar into a more attractive, detailed, accessible interface, while keeping the existing SAFEPOW brand identity and making zero backend/API changes.

**Architecture:** A new dark "hero" band (reusing the existing `sidebar` color tokens) replaces the flat KPI-card grid as the page's one bold visual element, backed by small pure-logic modules (gauge status, sparkline points, count-up animation, table percentages, severity mapping) that are unit-tested in isolation and then composed into new/updated presentational components. The categorical chart palette is replaced with a colorblind-validated set within the same brand hue family. All new logic and components are built test-first with Vitest + React Testing Library, which do not yet exist in `web-panel` and are set up in Task 1.

**Tech Stack:** Next.js 14 (App Router, client components), TypeScript, Tailwind CSS, shadcn/ui (Radix primitives), Recharts, Vitest, @testing-library/react, @testing-library/user-event.

**Spec:** No separate spec file — this is a bounded redesign of an existing page, designed in chat during brainstorming (see conversation). This plan is the authoritative reference for implementation.

## Global Constraints

- All UI copy stays in pt-BR, matching the rest of the app.
- Keep the existing SAFEPOW brand tokens (fonts, primary/secondary colors) untouched. The only color tokens that change are the five categorical chart tokens (`--chart-1` … `--chart-5`), to the exact validated values below.
- No backend/API contract changes. Every new widget is built from data the dashboard already fetches.
- Test files are **colocated** as `*.spec.ts` / `*.spec.tsx` next to the file they test (matching the `backend/` convention), not in `__tests__` folders.
- Vitest + Testing Library cover pure logic and rendered behavior (text content, attributes, CSS classes present, callbacks firing). Responsive layout, print output, and the hero's entrance animation timing are **not** meaningfully assertable in jsdom — those are verified manually in the browser in Task 15, not via unit tests.
- Empty-state copy must stay byte-for-byte `"Nenhuma perda registrada no período selecionado."` wherever it already appears — later tasks' tests assert on this exact string.
- Validated categorical chart palette (from the dataviz skill's CVD validator, `stroke`/`fill` on the actual card surfaces):
  - Light: `--chart-1: 45 180 180`, `--chart-2: 180 146 45`, `--chart-3: 155 81 39`, `--chart-4: 39 155 107`, `--chart-5: 116 39 155`
  - Dark: `--chart-1: 0 153 153`, `--chart-2: 153 115 0`, `--chart-3: 173 29 0`, `--chart-4: 0 133 77`, `--chart-5: 143 0 214`
- Run `npm test` (Vitest) from `web-panel/` after every task's implementation step. **Do not run `npm run lint`** — ESLint is not installed in this project (`next lint`/`next build`'s lint pass fails with "ESLint must be installed", pre-existing and out of scope for this plan). Use `npm run build` (from `web-panel/`) instead where the plan calls for a broader check — it still runs the TypeScript type-check and a full production compile, and exits 0 despite the (expected, harmless) ESLint warning.

---

### Task 1: Test harness (Vitest + React Testing Library)

**Files:**
- Modify: `web-panel/package.json`
- Create: `web-panel/vitest.config.ts`
- Create: `web-panel/vitest.setup.ts`
- Test: `web-panel/src/lib/smoke.spec.tsx`

**Interfaces:**
- Produces: a working `npm test` command in `web-panel/`, jsdom environment, `@` path alias resolving to `web-panel/src`, jest-dom matchers global, and a `ResizeObserver` polyfill (Recharts' `ResponsiveContainer` throws without one in jsdom — needed by Tasks 6, 7 and 12).

This task is scaffolding (config + dependencies), so it doesn't follow a literal red/green cycle for a feature — there is no feature yet, only the harness itself. Its own "test" is the smoke test proving the harness works end-to-end.

- [ ] **Step 1: Add test dependencies and script to `package.json`**

Add to `devDependencies`:
```json
"@testing-library/jest-dom": "^6.6.3",
"@testing-library/react": "^16.0.1",
"@testing-library/user-event": "^14.5.2",
"@vitejs/plugin-react": "^4.3.4",
"jsdom": "^25.0.1",
"vitest": "^2.1.8"
```

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Install dependencies**

Run (from `web-panel/`): `npm install`

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Create `vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom does not implement ResizeObserver; Recharts' ResponsiveContainer needs it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  // @ts-expect-error - test-environment polyfill
  globalThis.ResizeObserver = ResizeObserverMock;
}
```

- [ ] **Step 5: Write the smoke test**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello() {
  return <div>ok</div>;
}

describe('test harness', () => {
  it('renders react components with jsdom and jest-dom matchers', () => {
    render(<Hello />);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npm test`
Expected: `1 passed` for `src/lib/smoke.spec.tsx`, no errors.

- [ ] **Step 7: Commit**

```bash
git add web-panel/package.json web-panel/package-lock.json web-panel/vitest.config.ts web-panel/vitest.setup.ts web-panel/src/lib/smoke.spec.tsx
git commit -m "test(web-panel): add Vitest + Testing Library harness"
```

---

### Task 2: Shared currency/date formatters (dedupe)

**Files:**
- Create: `web-panel/src/lib/format.ts`
- Test: `web-panel/src/lib/format.spec.ts`
- Modify: `web-panel/src/app/(protected)/dashboard/page.tsx`
- Modify: `web-panel/src/components/top-offenders-table.tsx`
- Modify: `web-panel/src/components/losses-trend-chart.tsx`
- Modify: `web-panel/src/components/losses-breakdown-chart.tsx`

**Interfaces:**
- Produces: `formatBRL(value: number, options?: Intl.NumberFormatOptions): string`, `formatDateShortBR(iso: string): string` — consumed by Tasks 4, 7, 12 and by the modified files above.

`formatBRL` is currently defined identically (or near-identically) in four files. This extracts one shared, tested version.

- [ ] **Step 1: Write the failing test**

```ts
// web-panel/src/lib/format.spec.ts
import { describe, expect, it } from 'vitest';
import { formatBRL, formatDateShortBR } from './format';

describe('formatBRL', () => {
  it('formats a positive number as BRL currency', () => {
    expect(formatBRL(1234.5)).toMatch(/R\$\s*1\.234,50/);
  });

  it('formats zero as BRL currency', () => {
    expect(formatBRL(0)).toMatch(/R\$\s*0,00/);
  });

  it('accepts Intl.NumberFormatOptions overrides', () => {
    expect(formatBRL(1234.5, { maximumFractionDigits: 0 })).toMatch(/R\$\s*1\.235/);
  });
});

describe('formatDateShortBR', () => {
  it('formats an ISO date as dd/mm', () => {
    expect(formatDateShortBR('2026-03-05T12:00:00.000Z')).toBe('05/03');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- format.spec.ts`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web-panel/src/lib/format.ts
export function formatBRL(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', ...options });
}

export function formatDateShortBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- format.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Replace the duplicated definitions**

In `dashboard/page.tsx`: delete the local `formatBRL` function (lines 30-32), add `import { formatBRL } from '@/lib/format';`.

In `top-offenders-table.tsx`: delete the local `formatBRL` function, add `import { formatBRL } from '@/lib/format';`.

In `losses-trend-chart.tsx`: delete the local `formatBRL` and `formatDateShort` functions, add `import { formatBRL, formatDateShortBR } from '@/lib/format';`, and update call sites: `formatBRL(v)` → `formatBRL(v, { maximumFractionDigits: 0 })` (this file always rendered whole reais with no cents), `formatDateShort(...)` → `formatDateShortBR(...)`.

In `losses-breakdown-chart.tsx`: delete the local `formatBRL` function, add `import { formatBRL } from '@/lib/format';`.

- [ ] **Step 6: Run the full test suite and a build check**

Run: `npm test && npm run build`
Expected: all Vitest tests green; the build compiles and type-checks successfully (ignore the pre-existing "ESLint must be installed" warning — see Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add web-panel/src/lib/format.ts web-panel/src/lib/format.spec.ts web-panel/src/app/\(protected\)/dashboard/page.tsx web-panel/src/components/top-offenders-table.tsx web-panel/src/components/losses-trend-chart.tsx web-panel/src/components/losses-breakdown-chart.tsx
git commit -m "refactor(web-panel): extract shared formatBRL/formatDateShortBR"
```

---

### Task 3: Colorblind-safe categorical chart palette

**Files:**
- Modify: `web-panel/src/app/globals.css`
- Test: `web-panel/src/app/chart-palette.spec.ts`

**Interfaces:**
- Produces: updated `--chart-1..5` CSS custom properties. `tailwind.config.ts` already maps these unchanged (`chart.N: 'rgb(var(--chart-N) / <alpha-value>)'`) — no config changes needed. Consumed visually by `losses-breakdown-chart.tsx`'s `SLICE_COLORS` array (unchanged, still reads `rgb(var(--chart-N))`).

The current `--chart-1..5` values fail the dataviz skill's colorblind-safety validator (chroma below floor, adjacent pairs indistinguishable even with normal vision). This swaps in a validated set anchored on the brand's teal and gold hues plus three new, well-separated hues (clay, sage, plum).

- [ ] **Step 1: Write the failing test**

```ts
// web-panel/src/app/chart-palette.spec.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(__dirname, './globals.css'), 'utf-8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  const braceStart = css.indexOf('{', start);
  const braceEnd = css.indexOf('}', braceStart);
  return css.slice(braceStart, braceEnd);
}

const EXPECTED_LIGHT: Record<string, string> = {
  '--chart-1': '45 180 180',
  '--chart-2': '180 146 45',
  '--chart-3': '155 81 39',
  '--chart-4': '39 155 107',
  '--chart-5': '116 39 155',
};

const EXPECTED_DARK: Record<string, string> = {
  '--chart-1': '0 153 153',
  '--chart-2': '153 115 0',
  '--chart-3': '173 29 0',
  '--chart-4': '0 133 77',
  '--chart-5': '143 0 214',
};

describe('chart categorical palette (CVD-validated)', () => {
  const light = block(':root {');
  const dark = block(':root.dark {');

  for (const [token, value] of Object.entries(EXPECTED_LIGHT)) {
    it(`light ${token} is ${value}`, () => {
      expect(light).toContain(`${token}: ${value};`);
    });
  }

  for (const [token, value] of Object.entries(EXPECTED_DARK)) {
    it(`dark ${token} is ${value}`, () => {
      expect(dark).toContain(`${token}: ${value};`);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chart-palette.spec.ts`
Expected: FAIL on all 10 assertions — current values (`3 39 39`, `201 162 39`, etc.) don't match.

- [ ] **Step 3: Update `globals.css`**

In the `:root { ... }` block, replace:
```css
--chart-1: 3 39 39;
--chart-2: 201 162 39;
--chart-3: 67 87 87;
--chart-4: 138 74 61;
--chart-5: 107 143 135;
```
with:
```css
--chart-1: 45 180 180;
--chart-2: 180 146 45;
--chart-3: 155 81 39;
--chart-4: 39 155 107;
--chart-5: 116 39 155;
```

In the `:root.dark { ... }` block, replace:
```css
--chart-1: 111 168 158;
--chart-2: 224 196 92;
--chart-3: 150 168 168;
--chart-4: 199 133 115;
--chart-5: 138 176 168;
```
with:
```css
--chart-1: 0 153 153;
--chart-2: 153 115 0;
--chart-3: 173 29 0;
--chart-4: 0 133 77;
--chart-5: 143 0 214;
```

Update the comment above the light-mode chart tokens (currently "Paleta categórica dos gráficos — hues distintos...") to note the palette was re-validated for colorblind safety:
```css
/* Paleta categórica dos gráficos — validada com o script de daltonismo da
   skill dataviz (contraste CVD e leitura normal, ambos os modos). Âncoras de
   marca (verde-petróleo, dourado) preservadas; os outros 3 tons foram
   re-escolhidos para passar no validador. */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chart-palette.spec.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/app/globals.css web-panel/src/app/chart-palette.spec.ts
git commit -m "fix(web-panel): use a colorblind-validated categorical chart palette"
```

---

### Task 4: Table percentage bars

**Files:**
- Create: `web-panel/src/lib/table-metrics.ts`
- Test: `web-panel/src/lib/table-metrics.spec.ts`
- Modify: `web-panel/src/components/top-offenders-table.tsx`
- Test: `web-panel/src/components/top-offenders-table.spec.tsx`

**Interfaces:**
- Produces: `percentOfTotal(value: number, total: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// web-panel/src/lib/table-metrics.spec.ts
import { describe, expect, it } from 'vitest';
import { percentOfTotal } from './table-metrics';

describe('percentOfTotal', () => {
  it('returns the value as a percentage of the total', () => {
    expect(percentOfTotal(25, 100)).toBe(25);
  });

  it('returns 0 when total is zero', () => {
    expect(percentOfTotal(10, 0)).toBe(0);
  });

  it('returns 0 when total is negative', () => {
    expect(percentOfTotal(10, -5)).toBe(0);
  });

  it('clamps to 100 when value exceeds total', () => {
    expect(percentOfTotal(150, 100)).toBe(100);
  });

  it('clamps to 0 when value is negative', () => {
    expect(percentOfTotal(-10, 100)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- table-metrics.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// web-panel/src/lib/table-metrics.ts
export function percentOfTotal(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- table-metrics.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing component test**

```tsx
// web-panel/src/components/top-offenders-table.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopOffendersTable } from './top-offenders-table';

const rows = [
  { productId: '1', productName: 'Produto A', totalQuantity: '10', totalFinancialLoss: '80', totalCostLoss: '40' },
  { productId: '2', productName: 'Produto B', totalQuantity: '5', totalFinancialLoss: '20', totalCostLoss: '10' },
];

describe('TopOffendersTable', () => {
  it('renders a progress bar sized to each row percent of total', () => {
    render(<TopOffendersTable data={rows} />);
    const bars = screen.getAllByTestId('offender-bar');
    expect(bars[0]).toHaveStyle({ width: '80%' });
    expect(bars[1]).toHaveStyle({ width: '20%' });
  });

  it('shows the empty state when there is no data', () => {
    render(<TopOffendersTable data={[]} />);
    expect(screen.getByText('Nenhuma perda registrada no período selecionado.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- top-offenders-table.spec.tsx`
Expected: FAIL — no element with `data-testid="offender-bar"`.

- [ ] **Step 7: Implement the bar in `top-offenders-table.tsx`**

Add `import { percentOfTotal } from '@/lib/table-metrics';` and replace the inline percent calculation and its `TableCell`:

```tsx
const percent = percentOfTotal(financialLoss, total);
```

```tsx
<TableCell className="text-right text-muted-foreground">
  <div className="flex items-center justify-end gap-2">
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
      <div
        data-testid="offender-bar"
        className="h-full rounded-full bg-primary"
        style={{ width: `${percent}%` }}
      />
    </div>
    <span className="tabular-nums">{percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
  </div>
</TableCell>
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- top-offenders-table.spec.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 9: Commit**

```bash
git add web-panel/src/lib/table-metrics.ts web-panel/src/lib/table-metrics.spec.ts web-panel/src/components/top-offenders-table.tsx web-panel/src/components/top-offenders-table.spec.tsx
git commit -m "feat(web-panel): add magnitude bars to the top offenders table"
```

---

### Task 5: Shrinkage rate gauge

**Files:**
- Create: `web-panel/src/lib/shrinkage-gauge.ts`
- Test: `web-panel/src/lib/shrinkage-gauge.spec.ts`
- Create: `web-panel/src/components/shrinkage-gauge.tsx`
- Test: `web-panel/src/components/shrinkage-gauge.spec.tsx`

**Interfaces:**
- Produces: `shrinkageGaugeStatus(rate: number | null): { status: 'good'|'warning'|'critical'|'unknown'; angleDeg: number; label: string }`, `<ShrinkageGauge rate={number|null} />` — consumed by Task 14.

Thresholds match the existing copy in the dashboard ("faixa normal: 1–2%"): `good` at or below 1%, `warning` from 1% to 2%, `critical` above 2%. Gauge scale caps visually at 4%.

- [ ] **Step 1: Write the failing test**

```ts
// web-panel/src/lib/shrinkage-gauge.spec.ts
import { describe, expect, it } from 'vitest';
import { shrinkageGaugeStatus } from './shrinkage-gauge';

describe('shrinkageGaugeStatus', () => {
  it('returns unknown with zero angle when rate is null', () => {
    expect(shrinkageGaugeStatus(null)).toEqual({ status: 'unknown', angleDeg: 0, label: 'Sem dado' });
  });

  it('classifies rate at or below 1% as good', () => {
    expect(shrinkageGaugeStatus(0.5)).toMatchObject({ status: 'good', label: 'Saudável' });
    expect(shrinkageGaugeStatus(1)).toMatchObject({ status: 'good', label: 'Saudável' });
  });

  it('classifies rate between 1% and 2% as warning', () => {
    expect(shrinkageGaugeStatus(1.5)).toMatchObject({ status: 'warning', label: 'Atenção' });
    expect(shrinkageGaugeStatus(2)).toMatchObject({ status: 'warning', label: 'Atenção' });
  });

  it('classifies rate above 2% as critical', () => {
    expect(shrinkageGaugeStatus(2.1)).toMatchObject({ status: 'critical', label: 'Alto' });
  });

  it('maps 0% to a 0 degree angle and the 4% ceiling to 180 degrees', () => {
    expect(shrinkageGaugeStatus(0).angleDeg).toBe(0);
    expect(shrinkageGaugeStatus(4).angleDeg).toBe(180);
  });

  it('clamps the angle at 180 degrees above the 4% ceiling', () => {
    expect(shrinkageGaugeStatus(9).angleDeg).toBe(180);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- shrinkage-gauge.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// web-panel/src/lib/shrinkage-gauge.ts
export type ShrinkageStatus = 'good' | 'warning' | 'critical' | 'unknown';

export interface ShrinkageGaugeState {
  status: ShrinkageStatus;
  angleDeg: number;
  label: string;
}

const MAX_RATE = 4;

export function shrinkageGaugeStatus(rate: number | null): ShrinkageGaugeState {
  if (rate === null) {
    return { status: 'unknown', angleDeg: 0, label: 'Sem dado' };
  }

  const clamped = Math.min(MAX_RATE, Math.max(0, rate));
  const angleDeg = (clamped / MAX_RATE) * 180;

  if (rate <= 1) return { status: 'good', angleDeg, label: 'Saudável' };
  if (rate <= 2) return { status: 'warning', angleDeg, label: 'Atenção' };
  return { status: 'critical', angleDeg, label: 'Alto' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- shrinkage-gauge.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing component test**

```tsx
// web-panel/src/components/shrinkage-gauge.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShrinkageGauge } from './shrinkage-gauge';

describe('ShrinkageGauge', () => {
  it('renders the good status for a healthy rate', () => {
    render(<ShrinkageGauge rate={0.8} />);
    expect(screen.getByTestId('shrinkage-gauge')).toHaveAttribute('data-status', 'good');
    expect(screen.getByText(/saudável/i)).toBeInTheDocument();
  });

  it('renders the critical status for a high rate', () => {
    render(<ShrinkageGauge rate={3} />);
    expect(screen.getByTestId('shrinkage-gauge')).toHaveAttribute('data-status', 'critical');
    expect(screen.getByText(/alto/i)).toBeInTheDocument();
  });

  it('renders the unknown state when no rate is informed', () => {
    render(<ShrinkageGauge rate={null} />);
    expect(screen.getByTestId('shrinkage-gauge')).toHaveAttribute('data-status', 'unknown');
    expect(screen.getByText('Sem dado')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- shrinkage-gauge.spec.tsx`
Expected: FAIL — module not found (`./shrinkage-gauge` component).

- [ ] **Step 7: Write minimal implementation**

```tsx
// web-panel/src/components/shrinkage-gauge.tsx
import { shrinkageGaugeStatus } from '@/lib/shrinkage-gauge';
import { cn } from '@/lib/utils';

const STATUS_COLOR: Record<string, string> = {
  good: 'stroke-success text-success',
  warning: 'stroke-warning text-warning-foreground',
  critical: 'stroke-destructive text-destructive',
  unknown: 'stroke-muted-foreground text-muted-foreground',
};

function arcPoint(angleDeg: number, radius: number, cx: number, cy: number) {
  const rad = (Math.PI * angleDeg) / 180;
  return { x: cx - radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
}

export function ShrinkageGauge({ rate }: { rate: number | null }) {
  const { status, angleDeg, label } = shrinkageGaugeStatus(rate);
  const cx = 60;
  const cy = 56;
  const radius = 48;
  const start = arcPoint(0, radius, cx, cy);
  const end = arcPoint(angleDeg, radius, cx, cy);

  return (
    <div className="flex flex-col items-center gap-1" data-testid="shrinkage-gauge" data-status={status}>
      <svg viewBox="0 0 120 64" className="h-16 w-28">
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          strokeWidth={8}
          className="stroke-muted"
          strokeLinecap="round"
        />
        {angleDeg > 0 && (
          <path
            d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`}
            fill="none"
            strokeWidth={8}
            className={cn(STATUS_COLOR[status])}
            strokeLinecap="round"
          />
        )}
      </svg>
      <p className={cn('text-sm font-medium', STATUS_COLOR[status])}>
        {rate === null ? label : `${rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · ${label}`}
      </p>
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- shrinkage-gauge.spec.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add web-panel/src/lib/shrinkage-gauge.ts web-panel/src/lib/shrinkage-gauge.spec.ts web-panel/src/components/shrinkage-gauge.tsx web-panel/src/components/shrinkage-gauge.spec.tsx
git commit -m "feat(web-panel): add shrinkage rate gauge"
```

---

### Task 6: Sparkline points + count-up hook

**Files:**
- Create: `web-panel/src/lib/sparkline.ts`
- Test: `web-panel/src/lib/sparkline.spec.ts`
- Create: `web-panel/src/hooks/use-count-up.ts`
- Test: `web-panel/src/hooks/use-count-up.spec.ts`

**Interfaces:**
- Produces: `buildSparklinePoints(values: number[], width: number, height: number): { x: number; y: number }[]`, `pointsToPolyline(points): string`, `useCountUp(target: number, durationMs?: number): number` — consumed by Task 7.

- [ ] **Step 1: Write the failing sparkline test**

```ts
// web-panel/src/lib/sparkline.spec.ts
import { describe, expect, it } from 'vitest';
import { buildSparklinePoints, pointsToPolyline } from './sparkline';

describe('buildSparklinePoints', () => {
  it('returns an empty array for fewer than 2 values', () => {
    expect(buildSparklinePoints([], 100, 40)).toEqual([]);
    expect(buildSparklinePoints([5], 100, 40)).toEqual([]);
  });

  it('spaces points evenly across the given width', () => {
    const points = buildSparklinePoints([1, 2, 3, 4], 90, 40);
    expect(points.map((p) => p.x)).toEqual([0, 30, 60, 90]);
  });

  it('maps the highest value to y=0 and the lowest value to y=height', () => {
    const points = buildSparklinePoints([10, 50, 20], 100, 40);
    expect(points[1].y).toBe(0);
    expect(points[0].y).toBe(40);
  });

  it('centers all points vertically when every value is equal', () => {
    const points = buildSparklinePoints([7, 7, 7], 60, 40);
    expect(points.every((p) => p.y === 20)).toBe(true);
  });
});

describe('pointsToPolyline', () => {
  it('joins points into an SVG polyline points string', () => {
    expect(
      pointsToPolyline([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toBe('0.0,0.0 10.0,20.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sparkline.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// web-panel/src/lib/sparkline.ts
export interface SparklinePoint {
  x: number;
  y: number;
}

export function buildSparklinePoints(values: number[], width: number, height: number): SparklinePoint[] {
  if (values.length < 2) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const stepX = width / (values.length - 1);

  return values.map((value, index) => {
    const normalized = range === 0 ? 0.5 : (value - min) / range;
    return {
      x: index * stepX,
      y: height - normalized * height,
    };
  });
}

export function pointsToPolyline(points: SparklinePoint[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sparkline.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing count-up test**

```ts
// web-panel/src/hooks/use-count-up.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountUp } from './use-count-up';

describe('useCountUp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0 and reaches the target value after the full duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountUp(1000, 300));

    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(1000);
  });

  it('jumps straight to 0 when the target is 0', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountUp(0, 300));

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- use-count-up.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write minimal implementation**

```ts
// web-panel/src/hooks/use-count-up.ts
'use client';

import { useEffect, useState } from 'react';

const STEPS = 30;

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target <= 0) {
      setValue(target);
      return;
    }

    setValue(0);
    let step = 0;
    const stepMs = durationMs / STEPS;
    const id = setInterval(() => {
      step += 1;
      const progress = Math.min(1, step / STEPS);
      setValue(target * progress);
      if (progress >= 1) clearInterval(id);
    }, stepMs);

    return () => clearInterval(id);
  }, [target, durationMs]);

  return value;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- use-count-up.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 9: Commit**

```bash
git add web-panel/src/lib/sparkline.ts web-panel/src/lib/sparkline.spec.ts web-panel/src/hooks/use-count-up.ts web-panel/src/hooks/use-count-up.spec.ts
git commit -m "feat(web-panel): add sparkline point builder and count-up hook"
```

---

### Task 7: `DashboardHero` component

**Files:**
- Create: `web-panel/src/components/dashboard-hero.tsx`
- Test: `web-panel/src/components/dashboard-hero.spec.tsx`

**Interfaces:**
- Consumes: `formatBRL` (Task 2), `buildSparklinePoints`/`pointsToPolyline` (Task 6), `useCountUp` (Task 6).
- Produces: `<DashboardHero totalFinancialLoss previousMonthTotal variationPercent trendData projected filters? />` — consumed by Task 14.

- [ ] **Step 1: Write the failing test**

```tsx
// web-panel/src/components/dashboard-hero.spec.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DashboardHero } from './dashboard-hero';

describe('DashboardHero', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the animated total once the count-up finishes', () => {
    vi.useFakeTimers();
    render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[{ totalFinancialLoss: '10' }, { totalFinancialLoss: '20' }]}
        projected={null}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByTestId('hero-value')).toHaveTextContent('1.000,00');
  });

  it('shows the previous month comparison and the variation badge', () => {
    render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
      />,
    );

    expect(screen.getByTestId('hero-comparison')).toHaveTextContent('800,00');
    expect(screen.getByText(/25,0% vs\. mês anterior/)).toBeInTheDocument();
  });

  it('shows the projected month-end line only when there is a positive projection', () => {
    const { rerender } = render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
      />,
    );
    expect(screen.queryByTestId('hero-projected')).not.toBeInTheDocument();

    rerender(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={{ totalFinancialLoss: 1500, financialVariationPercent: 10 }}
      />,
    );
    expect(screen.getByTestId('hero-projected')).toHaveTextContent('1.500,00');
  });

  it('renders the filters slot when provided', () => {
    render(
      <DashboardHero
        totalFinancialLoss={1000}
        previousMonthTotal={800}
        variationPercent={25}
        trendData={[]}
        projected={null}
        filters={<button>Filtrar período</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filtrar período' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dashboard-hero.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web-panel/src/components/dashboard-hero.tsx
'use client';

import type { ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { formatBRL } from '@/lib/format';
import { buildSparklinePoints, pointsToPolyline } from '@/lib/sparkline';
import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

export interface DashboardHeroProps {
  totalFinancialLoss: number;
  previousMonthTotal: number;
  variationPercent: number | null;
  trendData: { totalFinancialLoss: string | number }[];
  projected: { totalFinancialLoss: number; financialVariationPercent: number | null } | null;
  filters?: ReactNode;
}

const SPARK_WIDTH = 220;
const SPARK_HEIGHT = 48;

function HeroVariation({ percent }: { percent: number }) {
  const isFlat = Math.abs(percent) < 0.5;
  const isWorse = percent > 0;
  const Icon = isFlat ? Minus : isWorse ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        isFlat ? 'text-sidebar-foreground/70' : isWorse ? 'text-destructive' : 'text-success',
      )}
    >
      <Icon className="size-3.5" />
      {Math.abs(percent).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. mês anterior
    </span>
  );
}

export function DashboardHero({
  totalFinancialLoss,
  previousMonthTotal,
  variationPercent,
  trendData,
  projected,
  filters,
}: DashboardHeroProps) {
  const animatedValue = useCountUp(totalFinancialLoss);
  const sparkValues = trendData.map((row) => Number(row.totalFinancialLoss));
  const points = buildSparklinePoints(sparkValues, SPARK_WIDTH, SPARK_HEIGHT);

  return (
    <div className="overflow-hidden rounded-xl bg-sidebar p-6 text-sidebar-foreground print:bg-transparent print:text-foreground print:ring-1 print:ring-border sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-sidebar-foreground/70">Prejuízo total no mês (venda)</p>
          <p className="font-display text-4xl sm:text-5xl" data-testid="hero-value">
            {formatBRL(animatedValue)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-sidebar-foreground/80">
            <span data-testid="hero-comparison">Mês anterior: {formatBRL(previousMonthTotal)}</span>
            {variationPercent !== null && <HeroVariation percent={variationPercent} />}
          </div>
          {projected && projected.totalFinancialLoss > 0 && (
            <p className="mt-2 text-sm text-sidebar-foreground/70" data-testid="hero-projected">
              Projeção de fechamento: {formatBRL(projected.totalFinancialLoss)}
              {projected.financialVariationPercent !== null && (
                <>
                  {' '}
                  ({projected.financialVariationPercent > 0 ? '+' : ''}
                  {projected.financialVariationPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)
                </>
              )}
            </p>
          )}
        </div>

        {points.length > 0 && (
          <svg
            viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
            className="h-12 w-full max-w-[220px] text-sidebar-primary print:hidden"
            role="img"
            aria-label="Tendência do prejuízo no período"
          >
            <polyline
              points={pointsToPolyline(points)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {filters && <div className="mt-6 border-t border-sidebar-border/60 pt-4">{filters}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dashboard-hero.spec.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/components/dashboard-hero.tsx web-panel/src/components/dashboard-hero.spec.tsx
git commit -m "feat(web-panel): add DashboardHero component"
```

---

### Task 8: `KpiTile` compact stat variant

**Files:**
- Modify: `web-panel/src/components/kpi-card.tsx`
- Create: `web-panel/src/components/kpi-card.spec.tsx`

**Interfaces:**
- Produces: `<KpiTile label value hint? />` (new) alongside the existing `<KpiCard />` — consumed by Task 14. `KpiCard` itself is unchanged (kept for compatibility; this task only adds tests for it since the file is being touched).

- [ ] **Step 1: Write the failing test**

```tsx
// web-panel/src/components/kpi-card.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiCard, KpiTile } from './kpi-card';

describe('KpiCard', () => {
  it('renders the label and value', () => {
    render(<KpiCard label="Prejuízo" value="R$ 100,00" />);
    expect(screen.getByText('Prejuízo')).toBeInTheDocument();
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
  });

  it('renders the hint when no variation is provided', () => {
    render(<KpiCard label="Itens" value="10" hint="Mês anterior: 8" />);
    expect(screen.getByText('Mês anterior: 8')).toBeInTheDocument();
  });

  it('renders a worse-variation badge in red when the percent is positive', () => {
    render(<KpiCard label="Prejuízo" value="R$ 100,00" variationPercent={12.3} />);
    expect(screen.getByText(/12,3% vs\. mês anterior/)).toHaveClass('text-destructive');
  });

  it('renders a better-variation badge in green when the percent is negative', () => {
    render(<KpiCard label="Prejuízo" value="R$ 100,00" variationPercent={-12.3} />);
    expect(screen.getByText(/12,3% vs\. mês anterior/)).toHaveClass('text-emerald-600');
  });
});

describe('KpiTile', () => {
  it('renders label, value and optional hint', () => {
    render(<KpiTile label="Produto mais perdido" value="Refrigerante 2L" hint="No período filtrado" />);
    expect(screen.getByText('Produto mais perdido')).toBeInTheDocument();
    expect(screen.getByText('Refrigerante 2L')).toBeInTheDocument();
    expect(screen.getByText('No período filtrado')).toBeInTheDocument();
  });

  it('omits the hint paragraph when none is given', () => {
    render(<KpiTile label="Itens" value="10" />);
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- kpi-card.spec.tsx`
Expected: FAIL — `KpiTile` is not exported.

- [ ] **Step 3: Add `KpiTile` to `kpi-card.tsx`**

Append to the end of the file:

```tsx
export function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-lg text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- kpi-card.spec.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/components/kpi-card.tsx web-panel/src/components/kpi-card.spec.tsx
git commit -m "feat(web-panel): add KpiTile compact stat variant"
```

---

### Task 9: Unify alert/pattern severity styling

**Files:**
- Create: `web-panel/src/lib/severity.ts`
- Test: `web-panel/src/lib/severity.spec.ts`
- Modify: `web-panel/src/components/alerts-card.tsx`
- Create: `web-panel/src/components/alerts-card.spec.tsx`
- Modify: `web-panel/src/components/suspicious-patterns-card.tsx`
- Create: `web-panel/src/components/suspicious-patterns-card.spec.tsx`

**Interfaces:**
- Produces: `SEVERITY_STYLES: Record<AlertSeverity, { icon: LucideIcon; className: string }>`, `scoreToSeverity(score: number): AlertSeverity`.

`AlertsCard` already defines `SEVERITY_STYLES` locally; `SuspiciousPatternsCard` computes an equivalent but differently-thresholded color band inline (`scoreBadgeClassName`). This moves the shared map to `lib/severity.ts` and makes both cards use identical thresholds/colors.

- [ ] **Step 1: Write the failing test**

```ts
// web-panel/src/lib/severity.spec.ts
import { describe, expect, it } from 'vitest';
import { scoreToSeverity, SEVERITY_STYLES } from './severity';

describe('scoreToSeverity', () => {
  it('classifies scores at or above 50 as critical', () => {
    expect(scoreToSeverity(50)).toBe('critical');
    expect(scoreToSeverity(80)).toBe('critical');
  });

  it('classifies scores between 25 and 49 as warning', () => {
    expect(scoreToSeverity(25)).toBe('warning');
    expect(scoreToSeverity(49)).toBe('warning');
  });

  it('classifies scores below 25 as info', () => {
    expect(scoreToSeverity(24)).toBe('info');
    expect(scoreToSeverity(0)).toBe('info');
  });
});

describe('SEVERITY_STYLES', () => {
  it('defines a style entry for every alert severity', () => {
    expect(Object.keys(SEVERITY_STYLES).sort()).toEqual(['critical', 'info', 'success', 'warning']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- severity.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// web-panel/src/lib/severity.ts
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { AlertSeverity } from '@/lib/types';

export const SEVERITY_STYLES: Record<AlertSeverity, { icon: LucideIcon; className: string }> = {
  critical: { icon: ShieldAlert, className: 'bg-destructive/15 text-destructive' },
  warning: { icon: AlertTriangle, className: 'bg-warning/15 text-warning-foreground' },
  success: { icon: CheckCircle2, className: 'bg-success/15 text-success-foreground' },
  info: { icon: Info, className: 'bg-accent text-accent-foreground' },
};

export function scoreToSeverity(score: number): AlertSeverity {
  if (score >= 50) return 'critical';
  if (score >= 25) return 'warning';
  return 'info';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- severity.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing `AlertsCard` test**

```tsx
// web-panel/src/components/alerts-card.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsCard } from './alerts-card';
import type { LossAlert } from '@/lib/types';

const alerts: LossAlert[] = [
  { id: '1', severity: 'critical', title: 'Alerta crítico', description: 'Descrição 1' },
  { id: '2', severity: 'warning', title: 'Alerta de atenção', description: 'Descrição 2' },
  { id: '3', severity: 'info', title: 'Alerta informativo', description: 'Descrição 3' },
  { id: '4', severity: 'success', title: 'Alerta positivo', description: 'Descrição 4' },
];

describe('AlertsCard', () => {
  it('shows the empty message when there are no alerts', () => {
    render(<AlertsCard alerts={[]} />);
    expect(screen.getByText(/nenhum alerta no momento/i)).toBeInTheDocument();
  });

  it('shows only the first three alerts, with a dialog for the rest', async () => {
    render(<AlertsCard alerts={alerts} />);
    expect(screen.getByText('Alerta crítico')).toBeInTheDocument();
    expect(screen.getByText('Alerta de atenção')).toBeInTheDocument();
    expect(screen.getByText('Alerta informativo')).toBeInTheDocument();
    expect(screen.queryByText('Alerta positivo')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ver todos \(4\)/i }));
    expect(screen.getByText('Alerta positivo')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- alerts-card.spec.tsx`
Expected: FAIL only if the current file's behavior doesn't yet match (it should already pass, since Step 7 keeps behavior identical — this step exists to confirm the pre-refactor baseline still satisfies the test before changing its internals). If it passes already, proceed straight to Step 7's refactor and re-run afterward.

- [ ] **Step 7: Refactor `alerts-card.tsx` to use the shared severity map**

Remove the local `SEVERITY_STYLES` constant, add `import { SEVERITY_STYLES } from '@/lib/severity';`. No other logic changes.

- [ ] **Step 8: Run test to verify it still passes**

Run: `npm test -- alerts-card.spec.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 9: Write the failing `SuspiciousPatternsCard` test**

```tsx
// web-panel/src/components/suspicious-patterns-card.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuspiciousPatternsCard } from './suspicious-patterns-card';
import type { SuspiciousPatternEntry } from '@/lib/types';

const entries: SuspiciousPatternEntry[] = [
  { employeeId: '1', employeeName: 'Fulano', score: 60, reasons: ['Motivo 1'] },
];

describe('SuspiciousPatternsCard', () => {
  it('shows the empty message when there are no entries', () => {
    render(<SuspiciousPatternsCard entries={[]} />);
    expect(screen.getByText(/nenhum padrão fora do comum/i)).toBeInTheDocument();
  });

  it('renders the employee name, score and reasons, using the shared critical styling', () => {
    render(<SuspiciousPatternsCard entries={entries} />);
    expect(screen.getByText('Fulano')).toBeInTheDocument();
    expect(screen.getByText('60')).toHaveClass('bg-destructive/15', 'text-destructive');
    expect(screen.getByText('Motivo 1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm test -- suspicious-patterns-card.spec.tsx`
Expected: FAIL — the current inline `scoreBadgeClassName` produces the same classes today by coincidence, so this step may already pass; if so, this confirms the baseline before Step 11's refactor.

- [ ] **Step 11: Refactor `suspicious-patterns-card.tsx` to use the shared severity map**

Remove the local `scoreBadgeClassName` function. In `PatternRow`, replace:

```tsx
className={cn(
  'flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
  scoreBadgeClassName(entry.score),
)}
```

with:

```tsx
className={cn(
  'flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
  SEVERITY_STYLES[scoreToSeverity(entry.score)].className,
)}
```

Add `import { scoreToSeverity, SEVERITY_STYLES } from '@/lib/severity';`.

- [ ] **Step 12: Run test to verify it passes**

Run: `npm test -- suspicious-patterns-card.spec.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 13: Commit**

```bash
git add web-panel/src/lib/severity.ts web-panel/src/lib/severity.spec.ts web-panel/src/components/alerts-card.tsx web-panel/src/components/alerts-card.spec.tsx web-panel/src/components/suspicious-patterns-card.tsx web-panel/src/components/suspicious-patterns-card.spec.tsx
git commit -m "refactor(web-panel): unify alert and pattern severity styling"
```

---

### Task 10: Shared `EmptyState`

**Files:**
- Create: `web-panel/src/components/empty-state.tsx`
- Test: `web-panel/src/components/empty-state.spec.tsx`
- Modify: `web-panel/src/components/losses-trend-chart.tsx`
- Modify: `web-panel/src/components/losses-breakdown-chart.tsx`
- Modify: `web-panel/src/components/top-offenders-table.tsx`

**Interfaces:**
- Produces: `<EmptyState message className? />` — consumed by Task 12 and the three chart/table files here.

- [ ] **Step 1: Write the failing test**

```tsx
// web-panel/src/components/empty-state.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the given message', () => {
    render(<EmptyState message="Nenhum dado no período." />);
    expect(screen.getByText('Nenhum dado no período.')).toBeInTheDocument();
  });

  it('merges a custom className with the default layout classes', () => {
    render(<EmptyState message="Vazio" className="h-72" />);
    expect(screen.getByText('Vazio')).toHaveClass('h-72');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- empty-state.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web-panel/src/components/empty-state.tsx
import { cn } from '@/lib/utils';

export function EmptyState({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('flex h-40 items-center justify-center text-center text-sm text-muted-foreground', className)}>
      {message}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- empty-state.spec.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Adopt it in the three existing empty-state blocks**

In `losses-trend-chart.tsx`, replace:
```tsx
<div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
  Nenhuma perda registrada no período selecionado.
</div>
```
with:
```tsx
<EmptyState message="Nenhuma perda registrada no período selecionado." className="h-72" />
```
(add `import { EmptyState } from '@/components/empty-state';`)

In `losses-breakdown-chart.tsx`, replace the `h-64` empty block the same way, with `className="h-64"`.

In `top-offenders-table.tsx`, replace the `h-40` empty block the same way, with no `className` override (keeps the default `h-40`) — this must keep passing the Task 4 test that asserts the exact message text.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all green, including Task 4's `top-offenders-table.spec.tsx`.

- [ ] **Step 7: Commit**

```bash
git add web-panel/src/components/empty-state.tsx web-panel/src/components/empty-state.spec.tsx web-panel/src/components/losses-trend-chart.tsx web-panel/src/components/losses-breakdown-chart.tsx web-panel/src/components/top-offenders-table.tsx
git commit -m "refactor(web-panel): extract shared EmptyState component"
```

---

### Task 11: `Skeleton` loading primitive

**Files:**
- Create: `web-panel/src/components/ui/skeleton.tsx`
- Test: `web-panel/src/components/ui/skeleton.spec.tsx`

**Interfaces:**
- Produces: `<Skeleton className? />` — consumed by Task 14.

- [ ] **Step 1: Write the failing test**

```tsx
// web-panel/src/components/ui/skeleton.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('renders a status element with an accessible label and the given classes', () => {
    render(<Skeleton className="h-4 w-24" />);
    const el = screen.getByRole('status', { name: 'Carregando' });
    expect(el).toHaveClass('h-4', 'w-24', 'animate-pulse');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- skeleton.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web-panel/src/components/ui/skeleton.tsx
import * as React from "react"
import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="status"
      aria-label="Carregando"
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- skeleton.spec.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/components/ui/skeleton.tsx web-panel/src/components/ui/skeleton.spec.tsx
git commit -m "feat(web-panel): add Skeleton loading primitive"
```

---

### Task 12: Donut chart center total label

**Files:**
- Modify: `web-panel/src/components/losses-breakdown-chart.tsx`
- Create: `web-panel/src/components/losses-breakdown-chart.spec.tsx`

**Interfaces:**
- Consumes: `formatBRL` (Task 2, already wired in Task 2's Step 5), `EmptyState` (Task 10, already wired in Task 10's Step 5).

- [ ] **Step 1: Write the failing test**

```tsx
// web-panel/src/components/losses-breakdown-chart.spec.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LossesBreakdownChart } from './losses-breakdown-chart';

const byReason = [
  { id: '1', label: 'Vencimento', totalQuantity: '10', totalFinancialLoss: '60' },
  { id: '2', label: 'Quebra', totalQuantity: '5', totalFinancialLoss: '40' },
];

describe('LossesBreakdownChart', () => {
  it('shows the empty state when there is no data for the selected view', () => {
    render(<LossesBreakdownChart byReason={[]} byLocation={[]} view="reason" />);
    expect(screen.getByText('Nenhuma perda registrada no período selecionado.')).toBeInTheDocument();
  });

  it('shows the total of the selected breakdown in the center label', () => {
    render(<LossesBreakdownChart byReason={byReason} byLocation={[]} view="reason" />);
    expect(screen.getByTestId('breakdown-total')).toHaveTextContent('100,00');
  });

  it('lists every entry label in the legend', () => {
    render(<LossesBreakdownChart byReason={byReason} byLocation={[]} view="reason" />);
    expect(screen.getByText('Vencimento')).toBeInTheDocument();
    expect(screen.getByText('Quebra')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- losses-breakdown-chart.spec.tsx`
Expected: FAIL — no element with `data-testid="breakdown-total"`.

- [ ] **Step 3: Add the center total label**

Wrap the non-empty branch's `ChartContainer` in a `relative` div and add the label as a sibling:

```tsx
) : (
  <div className="relative">
    <ChartContainer config={chartConfig} className="mx-auto aspect-square h-64">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatBRL(Number(value))} hideLabel />} />
        <Pie data={chartData} dataKey="value" nameKey="label" innerRadius={55} outerRadius={90} strokeWidth={2}>
          {chartData.map((entry) => (
            <Cell key={entry.label} fill={entry.fill} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <p className="text-xs text-muted-foreground">Total</p>
      <p className="font-display text-lg text-foreground" data-testid="breakdown-total">
        {formatBRL(chartData.reduce((sum, row) => sum + row.value, 0))}
      </p>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- losses-breakdown-chart.spec.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/components/losses-breakdown-chart.tsx web-panel/src/components/losses-breakdown-chart.spec.tsx
git commit -m "feat(web-panel): show total in the breakdown donut's center"
```

---

### Task 13: Nav active-state refinement

**Files:**
- Modify: `web-panel/src/components/nav.tsx`
- Create: `web-panel/src/components/nav.spec.tsx`

**Interfaces:**
- No new exports; behavior-preserving visual refinement plus an `aria-current="page"` accessibility addition.

- [ ] **Step 1: Write the failing test**

```tsx
// web-panel/src/components/nav.spec.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Nav } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('Nav', () => {
  it('marks the active manager link with aria-current="page"', () => {
    render(<Nav user={{ id: '1', name: 'Ana', role: 'manager', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /perdas/i })).not.toHaveAttribute('aria-current');
  });

  it('shows only the employee link for the employee role', () => {
    render(<Nav user={{ id: '2', name: 'João', role: 'employee', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /perdas/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nav.spec.tsx`
Expected: FAIL — no `aria-current` attribute on the active link yet.

- [ ] **Step 3: Update `nav.tsx`**

For the leaf-link branch (the `Link` rendering `link.href`/`link.label`/`Icon` for non-group items), change:

```tsx
const active = pathname.startsWith(link.href);
const Icon = link.icon;
return (
  <Link
    key={link.href}
    href={link.href}
    className={cn(
      'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors',
      active
        ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
    )}
  >
    <Icon className="size-4 shrink-0" />
    {link.label}
  </Link>
);
```

to:

```tsx
const active = pathname.startsWith(link.href);
const Icon = link.icon;
return (
  <Link
    key={link.href}
    href={link.href}
    aria-current={active ? 'page' : undefined}
    className={cn(
      'flex items-center gap-2.5 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors',
      active
        ? 'border-l-sidebar-primary-foreground bg-sidebar-accent font-medium text-sidebar-foreground'
        : 'border-l-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
    )}
  >
    <Icon className="size-4 shrink-0" />
    {link.label}
  </Link>
);
```

Apply the same two additions (`aria-current={active ? 'page' : undefined}` plus the `border-l-2`/`border-l-sidebar-primary-foreground`/`border-l-transparent` treatment replacing the old `bg-sidebar-primary`/`text-sidebar-primary-foreground` pill) to the group-child `Link` inside `CollapsibleContent`.

The "Meu perfil" `Link` near the bottom of the file is a centered pill button, not a full-width row — it keeps its existing background-swap active treatment (`bg-sidebar-primary`/`text-sidebar-primary-foreground` vs. `bg-sidebar-accent`/`text-sidebar-foreground/80`) unchanged. Only add `aria-current={pathname.startsWith('/perfil') ? 'page' : undefined}` to it, for accessibility parity with the other links.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nav.spec.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/components/nav.tsx web-panel/src/components/nav.spec.tsx
git commit -m "feat(web-panel): refine nav active-state styling and add aria-current"
```

---

### Task 14: Dashboard page integration

**Files:**
- Modify: `web-panel/src/app/(protected)/dashboard/page.tsx`
- Create: `web-panel/src/app/(protected)/dashboard/page.spec.tsx`

**Interfaces:**
- Consumes: `DashboardHero` (Task 7), `KpiTile` (Task 8), `ShrinkageGauge` (Task 5), `Skeleton` (Task 11), `formatBRL` (Task 2, already imported since Task 2).

This is the integration task: it composes every previous task's component into the page, replaces the old 5-card KPI grid and the standalone filter/projection cards, and adds a loading skeleton + retry-on-error for the initial data batch.

- [ ] **Step 1: Write the failing test**

```tsx
// web-panel/src/app/(protected)/dashboard/page.spec.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './page';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const summary = {
  currentMonth: { totalQuantity: 12, totalFinancialLoss: 1000, totalCostLoss: 500 },
  previousMonth: { totalQuantity: 10, totalFinancialLoss: 800, totalCostLoss: 400 },
  financialVariationPercent: 25,
  costVariationPercent: 25,
  projectedMonthEnd: { totalQuantity: 20, totalFinancialLoss: 1800, totalCostLoss: 900, financialVariationPercent: 10 },
  shrinkageRate: 1.5,
};

function mockHappyPath() {
  (api.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
    if (path.startsWith('losses/reports/summary')) return summary;
    if (path.startsWith('losses/reports/alerts')) return [];
    if (path.startsWith('losses/reports/suspicious-patterns')) return [];
    if (path.startsWith('company-revenue')) return null;
    if (path.startsWith('losses/reports/by-product')) return [];
    if (path.startsWith('losses/reports/by-period')) return [];
    if (path.startsWith('losses/reports/by-reason')) return [];
    if (path.startsWith('losses/reports/by-location')) return [];
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the hero with the loaded monthly total', async () => {
    mockHappyPath();
    render(<DashboardPage />);

    expect(await screen.findByTestId('hero-value')).toHaveTextContent('1.000,00');
  });

  it('shows a retry button when the initial load fails, and recovers on retry', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path.startsWith('losses/reports/summary')) throw new Error('Erro de rede.');
      if (path.startsWith('losses/reports/alerts')) return [];
      if (path.startsWith('losses/reports/suspicious-patterns')) return [];
      if (path.startsWith('company-revenue')) return null;
      return [];
    });

    render(<DashboardPage />);

    const retryButton = await screen.findByRole('button', { name: /tentar novamente/i });

    mockHappyPath();
    await userEvent.click(retryButton);

    expect(await screen.findByTestId('hero-value')).toHaveTextContent('1.000,00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dashboard/page.spec.tsx`
Expected: FAIL — no `hero-value` test id exists yet in the page (it still renders the old KPI-card grid), and no "Tentar novamente" button exists.

- [ ] **Step 3: Rewrite `dashboard/page.tsx`**

Replace the whole file with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, Printer, Search } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import type {
  CompanyMonthlyRevenue,
  LossAlert,
  LossByLocationRow,
  LossByPeriodRow,
  LossByProductReportRow,
  LossByReasonRow,
  LossSummaryReport,
  SuspiciousPatternEntry,
} from '@/lib/types';
import { AlertsCard } from '@/components/alerts-card';
import { DashboardHero } from '@/components/dashboard-hero';
import { KpiTile } from '@/components/kpi-card';
import { LossesTrendChart } from '@/components/losses-trend-chart';
import { LossesBreakdownChart } from '@/components/losses-breakdown-chart';
import { ShrinkageGauge } from '@/components/shrinkage-gauge';
import { SuspiciousPatternsCard } from '@/components/suspicious-patterns-card';
import { TopOffendersTable } from '@/components/top-offenders-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

function toDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const QUICK_PERIODS = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
];

export default function DashboardPage() {
  const [summary, setSummary] = useState<LossSummaryReport | null>(null);
  const [alerts, setAlerts] = useState<LossAlert[]>([]);
  const [suspiciousPatterns, setSuspiciousPatterns] = useState<SuspiciousPatternEntry[]>([]);
  const [byProduct, setByProduct] = useState<LossByProductReportRow[]>([]);
  const [byPeriod, setByPeriod] = useState<LossByPeriodRow[]>([]);
  const [byReason, setByReason] = useState<LossByReasonRow[]>([]);
  const [byLocation, setByLocation] = useState<LossByLocationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [quickPeriod, setQuickPeriod] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [compositionView, setCompositionView] = useState<'reason' | 'location'>('reason');
  const [productQuery, setProductQuery] = useState('');
  const now = useMemo(() => new Date(), []);
  const [revenueInput, setRevenueInput] = useState('');
  const [revenueSaving, setRevenueSaving] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  function buildQuery(fromValue: string, toValue: string) {
    const params = new URLSearchParams();
    if (fromValue) params.set('from', new Date(fromValue).toISOString());
    if (toValue) params.set('to', new Date(toValue).toISOString());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function loadFilteredReports(fromValue = from, toValue = to) {
    const qs = buildQuery(fromValue, toValue);
    Promise.all([
      api.get<LossByProductReportRow[]>(`losses/reports/by-product${qs}`),
      api.get<LossByPeriodRow[]>(`losses/reports/by-period${qs}`),
      api.get<LossByReasonRow[]>(`losses/reports/by-reason${qs}`),
      api.get<LossByLocationRow[]>(`losses/reports/by-location${qs}`),
    ])
      .then(([product, period, reason, location]) => {
        setByProduct(product);
        setByPeriod(period);
        setByReason(reason);
        setByLocation(location);
        setError(null);
        setLastUpdatedAt(new Date());
      })
      .catch((e: ApiError) => setError(e.message));
  }

  function loadDashboardData() {
    setLoading(true);
    setInitialError(null);
    Promise.all([
      api.get<LossSummaryReport>('losses/reports/summary'),
      api.get<LossAlert[]>('losses/reports/alerts'),
      api.get<SuspiciousPatternEntry[]>('losses/reports/suspicious-patterns'),
      api.get<CompanyMonthlyRevenue | null>(`company-revenue?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
    ])
      .then(([summaryData, alertsData, patternsData, revenue]) => {
        setSummary(summaryData);
        setAlerts(alertsData);
        setSuspiciousPatterns(patternsData);
        setRevenueInput(revenue ? String(revenue.revenueAmount) : '');
      })
      .catch((e: ApiError) => setInitialError(e.message))
      .finally(() => setLoading(false));
    loadFilteredReports('', '');
  }

  useEffect(() => {
    loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQuickPeriod(label: string) {
    setQuickPeriod(label);
    const days = QUICK_PERIODS.find((p) => p.label === label)?.days;
    if (!days) return;
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    const fromStr = toDateInputValue(fromDate);
    const toStr = toDateInputValue(toDate);
    setFrom(fromStr);
    setTo(toStr);
    loadFilteredReports(fromStr, toStr);
  }

  function exportReport() {
    const total = byProduct.reduce((sum, row) => sum + Number(row.totalFinancialLoss), 0);
    const header = ['Produto', 'Quantidade', 'Prejuízo', '% do total'];
    const body = byProduct.map((row) => {
      const loss = Number(row.totalFinancialLoss);
      const percent = total === 0 ? 0 : (loss / total) * 100;
      return [row.productName, row.totalQuantity, loss.toFixed(2), percent.toFixed(1)];
    });
    const csv = [header, ...body].map((row) => row.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'relatorio-perdas-safepow.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveRevenue() {
    const amount = Number(revenueInput.replace(',', '.'));
    if (!revenueInput || Number.isNaN(amount) || amount < 0) {
      setRevenueError('Informe um valor válido.');
      return;
    }
    setRevenueSaving(true);
    setRevenueError(null);
    try {
      await api.put(`company-revenue/${now.getFullYear()}/${now.getMonth() + 1}`, { revenueAmount: amount });
      const updatedSummary = await api.get<LossSummaryReport>('losses/reports/summary');
      setSummary(updatedSummary);
    } catch (e) {
      setRevenueError(e instanceof ApiError ? e.message : 'Erro ao salvar faturamento.');
    } finally {
      setRevenueSaving(false);
    }
  }

  const topProduct = byProduct.length > 0 ? byProduct[0].productName : '—';
  const topReason = byReason.length > 0 ? byReason[0].label : '—';

  const filteredByProduct = useMemo(() => {
    const term = productQuery.trim().toLowerCase();
    if (!term) return byProduct;
    return byProduct.filter((row) => row.productName.toLowerCase().includes(term));
  }, [byProduct, productQuery]);

  const periodFilters = (
    <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
      <div className="space-y-1.5">
        <Label className="text-sidebar-foreground/70">Período rápido</Label>
        <Tabs value={quickPeriod ?? undefined} onValueChange={handleQuickPeriod}>
          <TabsList>
            {QUICK_PERIODS.map((preset) => (
              <TabsTrigger key={preset.label} value={preset.label}>
                {preset.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="space-y-1.5">
        <Label className="text-sidebar-foreground/70">De</Label>
        <div className="relative">
          <Input
            type="date"
            className="w-auto pr-9"
            value={from}
            onChange={(e) => {
              setQuickPeriod(null);
              setFrom(e.target.value);
            }}
          />
          <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-sidebar-foreground/70">Até</Label>
        <div className="relative">
          <Input
            type="date"
            className="w-auto pr-9"
            value={to}
            onChange={(e) => {
              setQuickPeriod(null);
              setTo(e.target.value);
            }}
          />
          <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
      <Button variant="outline" onClick={() => loadFilteredReports()}>
        Filtrar período
      </Button>
      {(from || to) && (
        <Button
          variant="ghost"
          onClick={() => {
            setFrom('');
            setTo('');
            setQuickPeriod(null);
            loadFilteredReports('', '');
          }}
        >
          Limpar filtro
        </Button>
      )}
      {lastUpdatedAt && (
        <p className="text-sm text-sidebar-foreground/60 lg:ml-auto">
          Dados atualizados hoje às{' '}
          {lastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-2xl text-foreground">Dashboard gerencial</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral das perdas registradas pelos funcionários pelo aplicativo.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer data-icon="inline-start" />
            Imprimir
          </Button>
          <Button onClick={exportReport}>
            <Download data-icon="inline-start" />
            Exportar relatório
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </div>
      ) : initialError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="mb-2">{initialError}</p>
          <Button variant="outline" size="sm" onClick={loadDashboardData}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <DashboardHero
            totalFinancialLoss={summary?.currentMonth.totalFinancialLoss ?? 0}
            previousMonthTotal={summary?.previousMonth.totalFinancialLoss ?? 0}
            variationPercent={summary?.financialVariationPercent ?? null}
            trendData={byPeriod}
            projected={summary?.projectedMonthEnd ?? null}
            filters={periodFilters}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Prejuízo de custo no mês"
              value={formatBRL(summary?.currentMonth.totalCostLoss ?? 0)}
              hint="Valor real pago pelos itens perdidos"
            />
            <KpiTile
              label="Itens descartados no mês"
              value={(summary?.currentMonth.totalQuantity ?? 0).toLocaleString('pt-BR')}
              hint={`Mês anterior: ${(summary?.previousMonth.totalQuantity ?? 0).toLocaleString('pt-BR')}`}
            />
            <KpiTile label="Produto mais perdido" value={topProduct} hint="No período filtrado abaixo" />
            <KpiTile label="Motivo mais comum" value={topReason} hint="No período filtrado abaixo" />
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Faturamento do mês e taxa de perda</CardTitle>
          <CardDescription>
            Informe o faturamento do mês corrente para ver a perda como percentual da receita — a métrica
            padrão do varejo (faixa normal: 1–2%).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label>Faturamento do mês (R$)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="w-48"
              value={revenueInput}
              onChange={(e) => setRevenueInput(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={saveRevenue} disabled={revenueSaving}>
            {revenueSaving ? 'Salvando...' : 'Salvar faturamento'}
          </Button>
          {revenueError && <p className="text-sm text-destructive">{revenueError}</p>}
          <div className="sm:ml-auto">
            <ShrinkageGauge rate={summary?.shrinkageRate ?? null} />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Evolução do prejuízo financeiro</CardTitle>
          </CardHeader>
          <CardContent>
            <LossesTrendChart data={byPeriod} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <CardTitle>Composição das perdas</CardTitle>
            <Tabs value={compositionView} onValueChange={(v) => setCompositionView(v as 'reason' | 'location')}>
              <TabsList>
                <TabsTrigger value="reason">Por motivo</TabsTrigger>
                <TabsTrigger value="location">Por local</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <LossesBreakdownChart byReason={byReason} byLocation={byLocation} view={compositionView} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top ofensores</CardTitle>
            <CardDescription>Produtos que mais impactaram o resultado financeiro</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-3 px-6 pb-4">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar produto..."
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                />
              </div>
              <Badge variant="secondary">{filteredByProduct.length} itens</Badge>
            </div>
            <div className="overflow-x-auto">
              <TopOffendersTable
                data={filteredByProduct}
                total={byProduct.reduce((sum, row) => sum + Number(row.totalFinancialLoss), 0)}
              />
            </div>
          </CardContent>
        </Card>

        <AlertsCard alerts={alerts} />
      </div>

      <SuspiciousPatternsCard entries={suspiciousPatterns} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dashboard/page.spec.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full test suite and a build check**

Run: `npm test && npm run build`
Expected: all green (ignore the pre-existing ESLint warning — see Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add web-panel/src/app/\(protected\)/dashboard/page.tsx web-panel/src/app/\(protected\)/dashboard/page.spec.tsx
git commit -m "feat(web-panel): integrate hero, KPI tiles, gauge and loading/retry states into the dashboard"
```

---

### Task 15: Responsive/print polish and manual browser verification

**Files:**
- (No further source changes expected beyond what Tasks 7 and 14 already added — `print:hidden` on the header actions and sparkline, `print:bg-transparent`/`print:ring-1` on the hero, `overflow-x-auto` on the table.)

This task has no unit test — jsdom cannot evaluate real layout, breakpoints, or print rendering. It is verified manually in the browser, per the project's UI-change verification workflow.

- [ ] **Step 1: Start the dev server and open the dashboard**

Use `preview_start` with the web-panel dev server config, log in as a manager, navigate to `/dashboard`.

- [ ] **Step 2: Verify light mode**

Screenshot the full page. Confirm: hero band renders with the animated total, sparkline, comparison chip, and period filters; KPI tiles row; shrinkage gauge shows the correct arc/color for the current rate; donut center total renders; table bars render; nav shows the accent-bar active state on "Dashboard".

- [ ] **Step 3: Verify dark mode**

Toggle the theme switch in the nav. Confirm all of the above remain legible (hero band is unchanged since `sidebar` tokens are mode-invariant; check KPI tiles, gauge colors, and chart palette all read correctly against the dark surfaces).

- [ ] **Step 4: Verify mobile width**

Use `resize_window` with the `mobile` preset, reload. Confirm: hero stacks vertically (number above sparkline above filters), KPI tiles wrap into 2 columns, the offenders table scrolls horizontally without breaking the page layout, nothing overflows horizontally at the page level.

- [ ] **Step 5: Verify print output**

Open the browser's print preview (or trigger `window.print()` via the "Imprimir" button) and confirm the hero band renders on a white background with dark text (not a solid dark block wasting ink), and the header action buttons and sparkline are hidden.

- [ ] **Step 6: Fix any visual issues found**

If any check in Steps 2-5 fails, fix the relevant Tailwind classes in the affected component and re-verify. Re-run `npm test` after any source change to confirm nothing regressed.

- [ ] **Step 7: Final full verification**

Run: `npm test && npm run build` (from `web-panel/`)
Expected: all green, production build succeeds (ignore the pre-existing ESLint warning — see Global Constraints).

- [ ] **Step 8: Commit any fixes from Step 6**

```bash
git add -A
git commit -m "fix(web-panel): responsive/print polish after manual verification"
```

(Skip this commit if Steps 2-5 found nothing to fix.)

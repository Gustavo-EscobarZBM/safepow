# Projeção de fechamento de mês Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar no dashboard uma projeção de "se continuar nesse ritmo, você deve fechar o mês com prejuízo de R$ X", calculada por extrapolação linear simples a partir do prejuízo acumulado até hoje.

**Architecture:** Função pura `projectMonthEnd(currentMonth, previousMonth, now)` em um arquivo novo (`losses-projection.ts`, mesmo padrão de `losses-alerts.ts` — lógica de negócio isolada, testável sem banco), consumida por `LossesService.reportSummary()` e exposta como campo novo `projectedMonthEnd` na resposta. Web-panel mostra o valor num novo KPI/aviso.

**Tech Stack:** NestJS + TypeScript (backend), Jest, Next.js + React (web-panel).

**Spec:** `docs/superpowers/specs/2026-09-12-dashboard-loss-prevention-features-design.md` (seção 2).

## Global Constraints

- Extrapolação linear: `total_do_mes_ate_agora ÷ dias_decorridos × dias_no_mês`.
- `dias_decorridos` = `now.getDate()` (nunca é 0, então sem risco de divisão por zero).
- `dias_no_mês` = último dia do mês corrente = `new Date(ano, mês+1, 0).getDate()`.
- Testes backend: `npx jest <arquivo>` a partir de `backend/`.
- Web-panel: sem suíte automatizada — verificação manual via Browser pane.

---

### Task 1: Função pura de projeção — TDD

**Files:**
- Create: `backend/src/modules/losses/losses-projection.ts`
- Test: `backend/src/modules/losses/losses-projection.spec.ts`

**Interfaces:**
- Produces: `projectMonthEnd(currentMonth: MonthTotals, previousMonth: MonthTotals, now: Date): MonthEndProjection`, `MonthTotals` (`{ totalQuantity, totalFinancialLoss, totalCostLoss }`), `MonthEndProjection` (`MonthTotals & { financialVariationPercent: number | null }`) — consumidos pela Task 2.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/losses/losses-projection.spec.ts`:

```typescript
import { projectMonthEnd } from './losses-projection';

describe('projectMonthEnd', () => {
  it('extrapola linearmente a partir do dia decorrido do mês', () => {
    // 15 de um mês de 30 dias -> fator 2x
    const now = new Date(2026, 3, 15); // abril/2026 tem 30 dias
    const currentMonth = { totalQuantity: 10, totalFinancialLoss: 100, totalCostLoss: 60 };
    const previousMonth = { totalQuantity: 0, totalFinancialLoss: 0, totalCostLoss: 0 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    expect(result.totalFinancialLoss).toBeCloseTo(200);
    expect(result.totalCostLoss).toBeCloseTo(120);
    expect(result.totalQuantity).toBeCloseTo(20);
  });

  it('calcula a variação percentual projetada vs. mês anterior', () => {
    const now = new Date(2026, 3, 15);
    const currentMonth = { totalQuantity: 10, totalFinancialLoss: 100, totalCostLoss: 60 };
    const previousMonth = { totalQuantity: 10, totalFinancialLoss: 150, totalCostLoss: 90 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    // projetado = 200; (200 - 150) / 150 * 100 = 33.33...
    expect(result.financialVariationPercent).toBeCloseTo(33.33, 1);
  });

  it('retorna variação nula quando não há prejuízo no mês anterior', () => {
    const now = new Date(2026, 3, 15);
    const currentMonth = { totalQuantity: 1, totalFinancialLoss: 50, totalCostLoss: 30 };
    const previousMonth = { totalQuantity: 0, totalFinancialLoss: 0, totalCostLoss: 0 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    expect(result.financialVariationPercent).toBeNull();
  });

  it('no primeiro dia do mês, projeta o dia inteiro sem dividir por zero', () => {
    const now = new Date(2026, 3, 1);
    const currentMonth = { totalQuantity: 1, totalFinancialLoss: 10, totalCostLoss: 6 };
    const previousMonth = { totalQuantity: 0, totalFinancialLoss: 0, totalCostLoss: 0 };

    const result = projectMonthEnd(currentMonth, previousMonth, now);

    // dia 1 de 30 -> fator 30x
    expect(result.totalFinancialLoss).toBeCloseTo(300);
    expect(Number.isFinite(result.totalFinancialLoss)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

A partir de `backend/`:

```bash
npx jest src/modules/losses/losses-projection.spec.ts
```

Esperado: FALHA — módulo `./losses-projection` não existe.

- [ ] **Step 3: Implementar**

Criar `backend/src/modules/losses/losses-projection.ts`:

```typescript
export interface MonthTotals {
  totalQuantity: number;
  totalFinancialLoss: number;
  totalCostLoss: number;
}

export interface MonthEndProjection extends MonthTotals {
  financialVariationPercent: number | null;
}

/**
 * Projeção de fechamento do mês por extrapolação linear simples: assume que
 * o ritmo de perdas do restante do mês será igual à média diária observada
 * até agora. Não é uma previsão sofisticada — é um alerta cedo o bastante
 * pro gerente agir antes do mês fechar, não uma garantia.
 */
export function projectMonthEnd(
  currentMonth: MonthTotals,
  previousMonth: MonthTotals,
  now: Date,
): MonthEndProjection {
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const factor = daysInMonth / daysElapsed;

  const totalQuantity = currentMonth.totalQuantity * factor;
  const totalFinancialLoss = currentMonth.totalFinancialLoss * factor;
  const totalCostLoss = currentMonth.totalCostLoss * factor;

  const financialVariationPercent =
    previousMonth.totalFinancialLoss === 0
      ? null
      : ((totalFinancialLoss - previousMonth.totalFinancialLoss) / previousMonth.totalFinancialLoss) * 100;

  return { totalQuantity, totalFinancialLoss, totalCostLoss, financialVariationPercent };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/losses/losses-projection.spec.ts
```

Esperado: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/losses/losses-projection.ts backend/src/modules/losses/losses-projection.spec.ts
git commit -m "feat(backend): funcao pura de projecao de fechamento de mes"
```

---

### Task 2: `LossesService.reportSummary` expõe `projectedMonthEnd`

**Files:**
- Modify: `backend/src/modules/losses/losses.service.ts`

**Interfaces:**
- Consumes: `projectMonthEnd` (Task 1).
- Produces: `reportSummary()` retorna `projectedMonthEnd: MonthEndProjection` — consumido pelo web-panel (Task 3).

- [ ] **Step 1: Importar e usar a função**

No topo de `backend/src/modules/losses/losses.service.ts`, adicionar o import:

```typescript
import { projectMonthEnd } from './losses-projection';
```

Dentro de `reportSummary()`, logo antes do `return`:

```typescript
    const costVariationPercent =
      previousMonth.totalCostLoss === 0
        ? null
        : ((currentMonth.totalCostLoss - previousMonth.totalCostLoss) / previousMonth.totalCostLoss) * 100;

    const projectedMonthEnd = projectMonthEnd(currentMonth, previousMonth, now);

    return { currentMonth, previousMonth, financialVariationPercent, costVariationPercent, projectedMonthEnd };
```

- [ ] **Step 2: Reconstruir e subir o backend**

A partir de `backend/`:

```bash
docker compose up -d --build backend
```

- [ ] **Step 3: Verificação de integração**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gerente.costprice@exemplo.com","password":"senha123"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

curl -s "http://localhost:3000/api/losses/reports/summary" -H "Authorization: Bearer $TOKEN"
```

Esperado: a resposta inclui `projectedMonthEnd` com `totalQuantity`, `totalFinancialLoss`, `totalCostLoss` e `financialVariationPercent`.

- [ ] **Step 4: Rodar a suíte completa do backend (regressão)**

```bash
npx jest
```

Esperado: todos os testes passando.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/losses/losses.service.ts
git commit -m "feat(backend): reportSummary expoe projectedMonthEnd"
```

---

### Task 3: Web-panel — aviso de projeção no dashboard

**Files:**
- Modify: `web-panel/src/lib/types.ts`
- Modify: `web-panel/src/app/(protected)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `LossSummaryReport.projectedMonthEnd` (Task 2).

- [ ] **Step 1: Atualizar os tipos**

Em `web-panel/src/lib/types.ts`, dentro de `LossSummaryReport`:

```typescript
export interface LossSummaryReport {
  currentMonth: { totalQuantity: number; totalFinancialLoss: number; totalCostLoss: number };
  previousMonth: { totalQuantity: number; totalFinancialLoss: number; totalCostLoss: number };
  financialVariationPercent: number | null;
  costVariationPercent: number | null;
  projectedMonthEnd: {
    totalQuantity: number;
    totalFinancialLoss: number;
    totalCostLoss: number;
    financialVariationPercent: number | null;
  };
}
```

- [ ] **Step 2: Adicionar o aviso no dashboard**

Em `web-panel/src/app/(protected)/dashboard/page.tsx`, logo depois do grid de KPIs (`</div>` que fecha o `grid ... lg:grid-cols-5`) e antes do `<Card>` do filtro de período, adicionar:

```tsx
      {summary && summary.currentMonth.totalFinancialLoss > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
          No ritmo atual, você deve fechar o mês com prejuízo de{' '}
          <strong>{formatBRL(summary.projectedMonthEnd.totalFinancialLoss)}</strong>
          {summary.projectedMonthEnd.financialVariationPercent !== null && (
            <>
              {' '}
              (
              {summary.projectedMonthEnd.financialVariationPercent > 0 ? '+' : ''}
              {summary.projectedMonthEnd.financialVariationPercent.toLocaleString('pt-BR', {
                maximumFractionDigits: 1,
              })}
              % vs. mês anterior)
            </>
          )}
          .
        </div>
      )}
```

- [ ] **Step 3: Verificar no browser**

Recarregar o dashboard no preview (empresa "Teste CostPrice", que já tem perdas registradas), confirmar que o aviso aparece com um valor de projeção maior que o prejuízo atual (já que estamos no meio do mês). Tirar screenshot.

- [ ] **Step 4: Commit**

```bash
git add web-panel/src/lib/types.ts "web-panel/src/app/(protected)/dashboard/page.tsx"
git commit -m "feat(web-panel): aviso de projecao de fechamento de mes no dashboard"
```

## Self-Review Notes

- **Cobertura da spec (seção 2):** função de extrapolação testada isoladamente (Task 1), integrada em `reportSummary` e verificada contra o backend real (Task 2), exibida no dashboard (Task 3). Sem mudança no mobile, como especificado.
- **Consistência de tipos:** `MonthEndProjection` definida na Task 1 é usada sem alteração de forma nas Tasks 2 e 3 (mesmos 4 campos).
- **Sem placeholders.**

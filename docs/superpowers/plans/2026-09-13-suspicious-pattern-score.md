# Score de padrão suspeito Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cruzar sinais já existentes nos registros de perda (concentração de valor, produto/motivo recorrente, qualidade do registro, tendência) num score de 0 a 100 por funcionário, para o gerente saber onde vale a pena olhar com mais atenção — sem acusar nem bloquear nada automaticamente.

**Architecture:** Função pura `computeSuspiciousPatterns()` (mesmo padrão de `losses-projection.ts`/`losses-shrinkage.ts`/`losses-alerts.ts`) recebe as perdas dos últimos 30 dias (+ 30 dias anteriores só para o sinal de tendência) já agrupadas por `LossesService`, calcula 8 sinais independentes por funcionário e soma pontos (score máximo 100). Novo endpoint `GET /losses/reports/suspicious-patterns` (MANAGER) expõe o resultado. Web-panel ganha um novo card "Padrões para revisar" no dashboard, no mesmo estilo visual do card de Alertas já existente.

**Tech Stack:** NestJS + TypeORM (backend), Next.js + shadcn/ui (web-panel). Sem mudança no app mobile.

**Spec:** [docs/superpowers/specs/2026-09-12-dashboard-loss-prevention-features-design.md](../specs/2026-09-12-dashboard-loss-prevention-features-design.md), seção 4 "Score de padrão suspeito" (os 8 sinais e pesos abaixo foram detalhados com o usuário depois da spec original, que só listava a ideia em alto nível).

## Global Constraints

- Janela de 30 dias para os sinais "atuais" (mesma janela do card de Alertas em `losses-alerts.ts`); o sinal de tendência pessoal usa também os 30 dias anteriores a isso.
- Só entram no resultado funcionários com no mínimo 3 perdas no período (`minSampleSize`) — evita ruído de amostra pequena.
- Score é a soma dos pesos dos sinais que dispararam, limitado a 100 (`Math.min(soma, 100)`) — a soma teórica dos 8 pesos é 110, então o teto de 100 só entra em jogo no caso raro de quase todos os sinais dispararem juntos.
- Só funcionários com score > 0 aparecem na lista, ordenada por score decrescente (empate: nome A-Z).
- Endpoint novo é `@Roles(UserRole.MANAGER)`, mesmo padrão dos outros relatórios em `losses.controller.ts`.
- Sem mudança no app mobile.

### Os 8 sinais (score 0-100)

| # | Sinal | Peso | Dispara quando |
|---|---|---|---|
| 1 | Concentração de valor no funcionário | 20 | Funcionário responde por ≥40% do prejuízo total da empresa no período |
| 2 | Produto de alto valor recorrente | 20 | ≥50% das próprias perdas do funcionário caem no mesmo produto, e esse produto está entre os 20% mais caros perdidos no período (percentil calculado sobre os preços distintos dos produtos com perda no período) |
| 3 | Motivo sempre igual | 10 | ≥70% das próprias perdas do funcionário usam o mesmo motivo |
| 4 | Mesma combinação produto+motivo repetida | 10 | ≥50% das próprias perdas são exatamente a mesma dupla produto+motivo |
| 5 | Quantidade média muito acima da empresa | 10 | Quantidade média por registro do funcionário é ≥2× a média geral da empresa no período |
| 6 | Tendência de alta pessoal | 10 | Prejuízo do funcionário no período atual é ≥2× o dele mesmo nos 30 dias anteriores (exige ≥3 registros também no período anterior) |
| 7 | Ausência de foto | 15 | ≥70% dos registros do funcionário sem foto |
| 8 | Descrição pobre | 15 | ≥50% dos registros com descrição menor que 10 caracteres |

---

### Task 1: Função pura `computeSuspiciousPatterns` (TDD)

**Files:**
- Create: `backend/src/modules/losses/losses-suspicious-patterns.ts`
- Create: `backend/src/modules/losses/losses-suspicious-patterns.spec.ts`

**Interfaces:**
- Consumes: `Loss` entity de `backend/src/modules/losses/loss.entity.ts` (campos `reportedByUserId`, `reportedBy.name`, `product.{id,name,unitPrice}`, `reason.{id,name}`, `quantity`, `description`, `imageUrl`).
- Produces: `computeSuspiciousPatterns(input: SuspiciousPatternsInput): SuspiciousPatternEntry[]` — `SuspiciousPatternsInput = { currentLosses: Loss[]; previousLosses: Loss[] }`, `SuspiciousPatternEntry = { employeeId: string; employeeName: string; score: number; reasons: string[] }`. Task 2 chama essa função a partir de `LossesService`.

- [ ] **Step 1: Escrever os testes falhos**

```typescript
import { Loss } from './loss.entity';
import { computeSuspiciousPatterns } from './losses-suspicious-patterns';

let idCounter = 0;

function makeLoss(overrides: Partial<{
  reportedByUserId: string;
  reportedByName: string;
  productId: string;
  productName: string;
  unitPrice: number;
  reasonId: string;
  reasonName: string;
  quantity: number;
  description: string | null;
  imageUrl: string | null;
  occurredAt: Date;
}> = {}): Loss {
  idCounter += 1;
  const n = idCounter;
  const {
    reportedByUserId = 'emp-1',
    reportedByName = 'Funcionário',
    productId = `prod-${n}`,
    productName = `Produto ${n}`,
    unitPrice = 10,
    reasonId = `reason-${n}`,
    reasonName = `Motivo ${n}`,
    quantity = 1,
    description = 'Descrição detalhada o suficiente para não contar como pobre',
    imageUrl = 'https://example.com/foto.jpg',
    occurredAt = new Date(),
  } = overrides;

  return {
    id: `loss-${n}`,
    companyId: 'company-1',
    company: undefined,
    clientGeneratedId: `cgid-${n}`,
    productId,
    product: { id: productId, name: productName, unitPrice } as Loss['product'],
    reportedByUserId,
    reportedBy: { id: reportedByUserId, name: reportedByName } as Loss['reportedBy'],
    quantity,
    locationId: 'loc-1',
    location: { id: 'loc-1', name: 'Local 1' } as Loss['location'],
    reasonId,
    reason: { id: reasonId, name: reasonName } as Loss['reason'],
    description,
    source: null,
    imageUrl,
    occurredAt,
    createdAt: new Date(),
  } as unknown as Loss;
}

describe('computeSuspiciousPatterns', () => {
  it('ignora funcionários com menos de 3 perdas no período (amostra mínima)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 1000 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 1000 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    expect(result).toEqual([]);
  });

  it('sinal 1: concentração de valor no funcionário (peso 20)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 30 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 30 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 30 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.score).toBe(20);
    expect(emp1.reasons.some((r) => r.includes('prejuízo total da empresa'))).toBe(true);
  });

  it('sinal 2: produto de alto valor recorrente (peso 20)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', productId: 'prod-caro', productName: 'Notebook', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'prod-caro', productName: 'Notebook', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'prod-caro', productName: 'Notebook', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Notebook'))).toBe(true);
  });

  it('sinal 3: motivo sempre igual (peso 10)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-furto', reasonName: 'Furto' }),
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-furto', reasonName: 'Furto' }),
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-furto', reasonName: 'Furto' }),
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-quebra', reasonName: 'Quebra' }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Furto'))).toBe(true);
  });

  it('sinal 4: mesma combinação produto+motivo repetida (peso 10)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p1', productName: 'Vinho', reasonId: 'r1', reasonName: 'Quebra' }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p1', productName: 'Vinho', reasonId: 'r1', reasonName: 'Quebra' }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p1', productName: 'Vinho', reasonId: 'r1', reasonName: 'Quebra' }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p2', productName: 'Suco', reasonId: 'r2', reasonName: 'Furto' }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Vinho') && r.includes('Quebra'))).toBe(true);
  });

  it('sinal 5: quantidade média muito acima da empresa (peso 10)', () => {
    // A média da empresa inclui as próprias perdas do emp-1, então é preciso
    // bastante "ruído" de baixa quantidade dos outros funcionários pra não
    // diluir a média geral pra perto da do emp-1 (com poucos registros, o
    // emp-1 sozinho já é boa parte da amostra).
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', quantity: 20 }),
      makeLoss({ reportedByUserId: 'emp-1', quantity: 20 }),
      makeLoss({ reportedByUserId: 'emp-1', quantity: 20 }),
      ...Array.from({ length: 10 }, () => makeLoss({ reportedByUserId: 'emp-2', quantity: 1 })),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Quantidade média'))).toBe(true);
  });

  it('sinal 6: tendência de alta pessoal (peso 10)', () => {
    const currentLosses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
    ];
    const previousLosses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses, previousLosses });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('dobrou'))).toBe(true);
  });

  it('sinal 7: ausência de foto (peso 15)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', imageUrl: null }),
      makeLoss({ reportedByUserId: 'emp-1', imageUrl: null }),
      makeLoss({ reportedByUserId: 'emp-1', imageUrl: null }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('sem foto'))).toBe(true);
  });

  it('sinal 8: descrição pobre (peso 15)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', description: 'curta' }),
      makeLoss({ reportedByUserId: 'emp-1', description: 'curta' }),
      makeLoss({ reportedByUserId: 'emp-1', description: 'curta' }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('descrição muito curta'))).toBe(true);
  });

  it('nunca ultrapassa 100 mesmo quando todos os sinais disparam juntos', () => {
    const currentLosses = [
      makeLoss({
        reportedByUserId: 'emp-1',
        productId: 'p-caro',
        productName: 'Caro',
        reasonId: 'r1',
        reasonName: 'Furto',
        unitPrice: 1000,
        quantity: 50,
        description: 'x',
        imageUrl: null,
      }),
      makeLoss({
        reportedByUserId: 'emp-1',
        productId: 'p-caro',
        productName: 'Caro',
        reasonId: 'r1',
        reasonName: 'Furto',
        unitPrice: 1000,
        quantity: 50,
        description: 'x',
        imageUrl: null,
      }),
      makeLoss({
        reportedByUserId: 'emp-1',
        productId: 'p-caro',
        productName: 'Caro',
        reasonId: 'r1',
        reasonName: 'Furto',
        unitPrice: 1000,
        quantity: 50,
        description: 'x',
        imageUrl: null,
      }),
      // "Ruído" de outros funcionários com quantidade baixa — sem isso, o
      // emp-1 sozinho dominaria a média geral e o sinal 5 não dispararia.
      ...Array.from({ length: 5 }, () => makeLoss({ reportedByUserId: 'emp-2', unitPrice: 5, quantity: 1 })),
    ];
    const previousLosses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10, quantity: 1 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10, quantity: 1 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10, quantity: 1 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses, previousLosses });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.score).toBeLessThanOrEqual(100);
    expect(emp1.score).toBe(100);
  });

  it('ordena por score decrescente e omite quem tem score zero', () => {
    const losses = [
      // emp-1: dispara concentração de valor (score alto)
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 500 }),
      // emp-2: perdas normais, nenhum sinal dispara
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    expect(result.map((r) => r.employeeId)).toEqual(['emp-1']);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && npx jest losses-suspicious-patterns.spec.ts`
Expected: FAIL — `Cannot find module './losses-suspicious-patterns'`.

- [ ] **Step 3: Implementar a função pura**

```typescript
import { Loss } from './loss.entity';

export interface SuspiciousPatternEntry {
  employeeId: string;
  employeeName: string;
  score: number;
  reasons: string[];
}

export interface SuspiciousPatternsInput {
  /** Perdas dos últimos 30 dias, com product/reason/reportedBy carregados. */
  currentLosses: Loss[];
  /** Perdas dos 30 dias anteriores a isso — usadas só pelo sinal de tendência pessoal. */
  previousLosses: Loss[];
}

/**
 * Limiares dos 8 sinais — documentados na spec (seção 4) e detalhados com o
 * usuário durante o brainstorming. Reaproveitam, onde faz sentido, os mesmos
 * números já usados no card de Alertas (losses-alerts.ts) pra manter a
 * linguagem coerente em todo o dashboard.
 */
export const SUSPICIOUS_PATTERN_THRESHOLDS = {
  minSampleSize: 3,
  employeeShareOfTotalPercent: 40,
  sameProductSharePercent: 50,
  highValueProductPercentile: 0.8,
  sameReasonSharePercent: 70,
  sameProductReasonComboSharePercent: 50,
  quantityAverageMultiplier: 2,
  trendMultiplier: 2,
  trendMinSample: 3,
  missingPhotoPercent: 70,
  poorDescriptionMinLength: 10,
  poorDescriptionSharePercent: 50,
};

/**
 * Soma teórica dos pesos é 110 (não 100) — de propósito: dificilmente todos os
 * 8 sinais disparam juntos, e o score final é sempre limitado a 100 (ver
 * computeSuspiciousPatterns). Isso evita ter que forçar pesos "quebrados" só
 * pra fechar em 100 exato.
 */
const WEIGHTS = {
  employeeShareOfTotal: 20,
  highValueProduct: 20,
  sameReason: 10,
  sameProductReasonCombo: 10,
  quantityAboveAverage: 10,
  personalTrendUp: 10,
  missingPhoto: 15,
  poorDescription: 15,
};

function lossValue(loss: Loss): number {
  return Number(loss.quantity) * Number(loss.product?.unitPrice ?? 0);
}

function pct(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

function formatPercent(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function groupByEmployee(losses: Loss[]): Map<string, { name: string; losses: Loss[] }> {
  const map = new Map<string, { name: string; losses: Loss[] }>();
  for (const loss of losses) {
    if (!loss.reportedBy) continue;
    const entry = map.get(loss.reportedByUserId) ?? { name: loss.reportedBy.name, losses: [] };
    entry.losses.push(loss);
    map.set(loss.reportedByUserId, entry);
  }
  return map;
}

function sumByEmployee(losses: Loss[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const loss of losses) {
    map.set(loss.reportedByUserId, (map.get(loss.reportedByUserId) ?? 0) + lossValue(loss));
  }
  return map;
}

function countByEmployee(losses: Loss[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const loss of losses) {
    map.set(loss.reportedByUserId, (map.get(loss.reportedByUserId) ?? 0) + 1);
  }
  return map;
}

/** Preço a partir do qual um produto entra no top 20% mais caro perdido no período. */
function computeHighValueThreshold(losses: Loss[]): number {
  const prices = [...new Set(losses.filter((l) => l.product).map((l) => Number(l.product!.unitPrice)))].sort(
    (a, b) => a - b,
  );
  if (prices.length === 0) return Infinity;
  const index = Math.min(
    prices.length - 1,
    Math.floor(prices.length * SUSPICIOUS_PATTERN_THRESHOLDS.highValueProductPercentile),
  );
  return prices[index];
}

export function computeSuspiciousPatterns(input: SuspiciousPatternsInput): SuspiciousPatternEntry[] {
  const { currentLosses, previousLosses } = input;

  const companyTotal = currentLosses.reduce((s, l) => s + lossValue(l), 0);
  const companyQuantityAverage =
    currentLosses.length === 0 ? 0 : currentLosses.reduce((s, l) => s + Number(l.quantity), 0) / currentLosses.length;
  const highValueThreshold = computeHighValueThreshold(currentLosses);
  const previousTotalsByEmployee = sumByEmployee(previousLosses);
  const previousCountsByEmployee = countByEmployee(previousLosses);

  const entries: SuspiciousPatternEntry[] = [];

  for (const [employeeId, { name, losses }] of groupByEmployee(currentLosses)) {
    if (losses.length < SUSPICIOUS_PATTERN_THRESHOLDS.minSampleSize) continue;

    let score = 0;
    const reasons: string[] = [];
    const employeeTotal = losses.reduce((s, l) => s + lossValue(l), 0);

    // 1. Concentração de valor no funcionário.
    const employeeShare = pct(employeeTotal, companyTotal);
    if (employeeShare >= SUSPICIOUS_PATTERN_THRESHOLDS.employeeShareOfTotalPercent) {
      score += WEIGHTS.employeeShareOfTotal;
      reasons.push(`Responde por ${formatPercent(employeeShare)}% do prejuízo total da empresa no período.`);
    }

    // 2. Produto de alto valor recorrente.
    const byProduct = new Map<string, { name: string; amount: number; price: number }>();
    for (const loss of losses) {
      if (!loss.product) continue;
      const entry = byProduct.get(loss.product.id) ?? {
        name: loss.product.name,
        amount: 0,
        price: Number(loss.product.unitPrice),
      };
      entry.amount += lossValue(loss);
      byProduct.set(loss.product.id, entry);
    }
    let topProduct: { name: string; amount: number; price: number } | null = null;
    for (const entry of byProduct.values()) {
      if (!topProduct || entry.amount > topProduct.amount) topProduct = entry;
    }
    if (topProduct) {
      const share = pct(topProduct.amount, employeeTotal);
      if (share >= SUSPICIOUS_PATTERN_THRESHOLDS.sameProductSharePercent && topProduct.price >= highValueThreshold) {
        score += WEIGHTS.highValueProduct;
        reasons.push(
          `Concentra ${formatPercent(share)}% das próprias perdas em "${topProduct.name}", um produto de alto valor.`,
        );
      }
    }

    // 3. Motivo sempre igual.
    const byReason = new Map<string, { name: string; count: number }>();
    for (const loss of losses) {
      if (!loss.reason) continue;
      const entry = byReason.get(loss.reason.id) ?? { name: loss.reason.name, count: 0 };
      entry.count += 1;
      byReason.set(loss.reason.id, entry);
    }
    let topReason: { name: string; count: number } | null = null;
    for (const entry of byReason.values()) {
      if (!topReason || entry.count > topReason.count) topReason = entry;
    }
    if (topReason) {
      const share = pct(topReason.count, losses.length);
      if (share >= SUSPICIOUS_PATTERN_THRESHOLDS.sameReasonSharePercent) {
        score += WEIGHTS.sameReason;
        reasons.push(`${formatPercent(share)}% dos registros usam sempre o motivo "${topReason.name}".`);
      }
    }

    // 4. Mesma combinação produto+motivo repetida.
    const byCombo = new Map<string, { productName: string; reasonName: string; count: number }>();
    for (const loss of losses) {
      if (!loss.product || !loss.reason) continue;
      const key = `${loss.product.id}::${loss.reason.id}`;
      const entry = byCombo.get(key) ?? { productName: loss.product.name, reasonName: loss.reason.name, count: 0 };
      entry.count += 1;
      byCombo.set(key, entry);
    }
    let topCombo: { productName: string; reasonName: string; count: number } | null = null;
    for (const entry of byCombo.values()) {
      if (!topCombo || entry.count > topCombo.count) topCombo = entry;
    }
    if (topCombo) {
      const share = pct(topCombo.count, losses.length);
      if (share >= SUSPICIOUS_PATTERN_THRESHOLDS.sameProductReasonComboSharePercent) {
        score += WEIGHTS.sameProductReasonCombo;
        reasons.push(
          `${formatPercent(share)}% dos registros repetem a mesma combinação "${topCombo.productName}" + "${topCombo.reasonName}".`,
        );
      }
    }

    // 5. Quantidade média muito acima da empresa.
    const employeeQuantityAverage = losses.reduce((s, l) => s + Number(l.quantity), 0) / losses.length;
    if (
      companyQuantityAverage > 0 &&
      employeeQuantityAverage >= companyQuantityAverage * SUSPICIOUS_PATTERN_THRESHOLDS.quantityAverageMultiplier
    ) {
      score += WEIGHTS.quantityAboveAverage;
      reasons.push(
        `Quantidade média de ${employeeQuantityAverage.toFixed(1)} por registro, bem acima da média da empresa (${companyQuantityAverage.toFixed(1)}).`,
      );
    }

    // 6. Tendência de alta pessoal (vs. os 30 dias anteriores).
    const previousCount = previousCountsByEmployee.get(employeeId) ?? 0;
    if (previousCount >= SUSPICIOUS_PATTERN_THRESHOLDS.trendMinSample) {
      const previousTotal = previousTotalsByEmployee.get(employeeId) ?? 0;
      if (previousTotal > 0 && employeeTotal >= previousTotal * SUSPICIOUS_PATTERN_THRESHOLDS.trendMultiplier) {
        score += WEIGHTS.personalTrendUp;
        reasons.push('Prejuízo pelo menos dobrou em relação aos 30 dias anteriores.');
      }
    }

    // 7. Ausência de foto.
    const missingPhotoShare = pct(losses.filter((l) => !l.imageUrl).length, losses.length);
    if (missingPhotoShare >= SUSPICIOUS_PATTERN_THRESHOLDS.missingPhotoPercent) {
      score += WEIGHTS.missingPhoto;
      reasons.push(`${formatPercent(missingPhotoShare)}% dos registros sem foto anexada.`);
    }

    // 8. Descrição pobre.
    const poorDescriptionShare = pct(
      losses.filter((l) => (l.description ?? '').trim().length < SUSPICIOUS_PATTERN_THRESHOLDS.poorDescriptionMinLength)
        .length,
      losses.length,
    );
    if (poorDescriptionShare >= SUSPICIOUS_PATTERN_THRESHOLDS.poorDescriptionSharePercent) {
      score += WEIGHTS.poorDescription;
      reasons.push(`${formatPercent(poorDescriptionShare)}% dos registros com descrição muito curta.`);
    }

    if (score > 0) {
      entries.push({ employeeId, employeeName: name, score: Math.min(score, 100), reasons });
    }
  }

  return entries.sort((a, b) => b.score - a.score || a.employeeName.localeCompare(b.employeeName));
}
```

Nota: `countByEmployee` existe separada de `sumByEmployee` porque o sinal 6 precisa de duas coisas distintas por funcionário — quantos registros existiam no período anterior (amostra mínima) e quanto isso valia (para comparar com o período atual).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && npx jest losses-suspicious-patterns.spec.ts`
Expected: PASS (11 testes). Se algum teste não bater exatamente (ex: sinal 2 disparando com peso diferente do esperado por causa de outro sinal concorrente na mesma fixture), ajuste a fixture do teste para isolar o sinal — não a implementação — a menos que a implementação esteja genuinamente errada frente às regras da tabela acima.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/losses/losses-suspicious-patterns.ts backend/src/modules/losses/losses-suspicious-patterns.spec.ts
git commit -m "feat(backend): funcao pura de score de padrao suspeito por funcionario"
```

---

### Task 2: Endpoint `GET /losses/reports/suspicious-patterns`

**Files:**
- Modify: `backend/src/modules/losses/losses.service.ts`
- Modify: `backend/src/modules/losses/losses.controller.ts`

**Interfaces:**
- Consumes: `computeSuspiciousPatterns` (Task 1), `getTenantManager()` de `backend/src/common/tenant/tenant-storage.ts`.
- Produces: `LossesService.reportSuspiciousPatterns(): Promise<SuspiciousPatternEntry[]>`, rota `GET /losses/reports/suspicious-patterns`.

- [ ] **Step 1: Adicionar o método no `LossesService`**

Em `backend/src/modules/losses/losses.service.ts`, adicionar o import (junto aos demais imports locais do módulo):

```typescript
import { computeSuspiciousPatterns, type SuspiciousPatternEntry } from './losses-suspicious-patterns';
```

E adicionar o método, logo após `reportAlerts()` (antes do `private async topProductIdsInRange(...)`):

```typescript
  /**
   * Card "Padrões para revisar" do dashboard: cruza sinais já existentes por
   * funcionário (losses-suspicious-patterns.ts) num score de 0 a 100 — não
   * acusa nem bloqueia, só aponta onde vale a pena olhar com mais atenção.
   */
  async reportSuspiciousPatterns(): Promise<SuspiciousPatternEntry[]> {
    const manager = getTenantManager();
    const now = new Date();
    const currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const currentLosses = await manager.find(Loss, {
      where: { occurredAt: Between(currentStart, now) },
      relations: { product: true, reason: true, reportedBy: true },
    });
    const previousLosses = await manager.find(Loss, {
      where: { occurredAt: Between(previousStart, currentStart) },
      relations: { product: true },
    });

    return computeSuspiciousPatterns({ currentLosses, previousLosses });
  }
```

- [ ] **Step 2: Adicionar a rota no controller**

Em `backend/src/modules/losses/losses.controller.ts`, adicionar, logo após o método `reportAlerts()`:

```typescript
  // Card "Padrões para revisar" do dashboard — score por funcionário em losses-suspicious-patterns.ts.
  @Get('reports/suspicious-patterns')
  @Roles(UserRole.MANAGER)
  reportSuspiciousPatterns() {
    return this.lossesService.reportSuspiciousPatterns();
  }
```

- [ ] **Step 3: Rodar a suíte completa do backend**

Run: `cd backend && npm test`
Expected: todos os testes passam, incluindo os 11 novos de `losses-suspicious-patterns`.

- [ ] **Step 4: Rebuild e verificação via curl com o backend rodando**

```bash
cd backend && docker compose build backend && docker compose up -d backend
```

Com um usuário MANAGER logado (token em `$TOKEN`):

```bash
curl -s http://localhost:3000/api/losses/reports/suspicious-patterns -H "Authorization: Bearer $TOKEN"
```

Expected: retorna um array JSON (pode ser vazio, dependendo dos dados de teste já existentes na empresa) de objetos `{ employeeId, employeeName, score, reasons }`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/losses/losses.service.ts backend/src/modules/losses/losses.controller.ts
git commit -m "feat(backend): endpoint GET /losses/reports/suspicious-patterns"
```

---

### Task 3: Web-panel — card "Padrões para revisar" no dashboard

**Files:**
- Modify: `web-panel/src/lib/types.ts`
- Create: `web-panel/src/components/suspicious-patterns-card.tsx`
- Modify: `web-panel/src/app/(protected)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /losses/reports/suspicious-patterns` (Task 2).
- Produces: componente `SuspiciousPatternsCard({ entries: SuspiciousPatternEntry[] })`.

- [ ] **Step 1: Adicionar o tipo**

Em `web-panel/src/lib/types.ts`, adicionar (após `CompanyMonthlyRevenue`):

```typescript
export interface SuspiciousPatternEntry {
  employeeId: string;
  employeeName: string;
  score: number;
  reasons: string[];
}
```

- [ ] **Step 2: Criar o componente, no mesmo estilo visual do `AlertsCard` já existente**

```tsx
'use client';

import { useState } from 'react';
import type { SuspiciousPatternEntry } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

function scoreBadgeClassName(score: number) {
  if (score >= 50) return 'bg-destructive/15 text-destructive';
  if (score >= 25) return 'bg-warning/15 text-warning-foreground';
  return 'bg-accent text-accent-foreground';
}

function PatternRow({ entry }: { entry: SuspiciousPatternEntry }) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
          scoreBadgeClassName(entry.score),
        )}
      >
        {entry.score}
      </div>
      <div>
        <p className="font-semibold">{entry.employeeName}</p>
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
          {entry.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PatternList({ entries }: { entries: SuspiciousPatternEntry[] }) {
  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry, index) => (
        <div key={entry.employeeId} className="contents">
          <PatternRow entry={entry} />
          {index < entries.length - 1 && <Separator />}
        </div>
      ))}
    </div>
  );
}

export function SuspiciousPatternsCard({ entries }: { entries: SuspiciousPatternEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = entries.slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Padrões para revisar</CardTitle>
        <CardDescription>Sinais cruzados por funcionário — não é acusação, é um ponto de partida</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum padrão fora do comum no período.</p>
        ) : (
          <>
            <PatternList entries={visible} />
            {entries.length > visible.length && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setShowAll(true)}>
                Ver todos ({entries.length})
              </Button>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Padrões para revisar</DialogTitle>
            <DialogDescription>Todos os funcionários com algum sinal no período analisado.</DialogDescription>
          </DialogHeader>
          <PatternList entries={entries} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 3: Integrar no dashboard**

Em `web-panel/src/app/(protected)/dashboard/page.tsx`:

Adicionar `SuspiciousPatternEntry` ao import de tipos existente (`import type { CompanyMonthlyRevenue, LossAlert, ... } from '@/lib/types';`) e importar o componente:

```typescript
import { SuspiciousPatternsCard } from '@/components/suspicious-patterns-card';
```

Adicionar estado, junto a `const [alerts, setAlerts] = useState<LossAlert[]>([]);`:

```typescript
  const [suspiciousPatterns, setSuspiciousPatterns] = useState<SuspiciousPatternEntry[]>([]);
```

Adicionar o carregamento, no mesmo `useEffect` que já busca `alerts`, logo após aquela chamada:

```typescript
    api
      .get<SuspiciousPatternEntry[]>('losses/reports/suspicious-patterns')
      .then(setSuspiciousPatterns)
      .catch((e: ApiError) => setError(e.message));
```

Adicionar o card no JSX, logo após o `</div>` que fecha o grid "Top ofensores + Alertas" (o último elemento do arquivo antes do fechamento do componente):

```tsx
      <SuspiciousPatternsCard entries={suspiciousPatterns} />
```

- [ ] **Step 4: Verificar no navegador**

Com o backend e o web-panel rodando, logar como gerente, abrir `/dashboard` e confirmar que o card "Padrões para revisar" aparece (vazio ou com itens, dependendo dos dados de teste). Se houver funcionários com perdas concentradas nos dados de teste já existentes, confirmar visualmente que o score e os motivos batem com os sinais esperados.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/lib/types.ts web-panel/src/components/suspicious-patterns-card.tsx "web-panel/src/app/(protected)/dashboard/page.tsx"
git commit -m "feat(web-panel): card de padroes suspeitos no dashboard"
```

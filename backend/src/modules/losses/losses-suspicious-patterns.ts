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

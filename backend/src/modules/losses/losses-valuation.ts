import { EntityManager, LessThanOrEqual } from 'typeorm';
import { ProductPriceHistory } from '../products/product-price-history.entity';
import { Product } from '../products/product.entity';
import { Loss, LossValuationSource } from './loss.entity';

export interface LossValuation {
  unitPrice: number;
  unitCost: number;
  source: LossValuationSource;
}

/**
 * Preço/custo vigentes em `occurredAt` (spec do SP1, seção 4.2):
 * 1. a última linha do histórico com validFrom <= occurredAt (desempate por seq);
 * 2. senão, a MAIS ANTIGA — occurredAt anterior à 1ª linha acontece quando o relógio do aparelho está
 *    atrasado em relação à criação do produto; o preço mais antigo é o melhor palpite, não o atual;
 * 3. senão (produto sem histórico — não deveria ocorrer depois do backfill da 1.2.2), o preço atual,
 *    marcado fallback_current para ficar visível e auditável.
 * O manager tem de ser o da requisição (RLS ativa): o histórico de outra empresa nunca é enxergado.
 */
export async function resolveLossValuation(
  manager: EntityManager,
  product: Pick<Product, 'id' | 'unitPrice' | 'costPrice'>,
  occurredAt: Date,
): Promise<LossValuation> {
  const inEffect = await manager.findOne(ProductPriceHistory, {
    where: { productId: product.id, validFrom: LessThanOrEqual(occurredAt) },
    order: { validFrom: 'DESC', seq: 'DESC' },
  });
  const row =
    inEffect ??
    (await manager.findOne(ProductPriceHistory, {
      where: { productId: product.id },
      order: { validFrom: 'ASC', seq: 'ASC' },
    }));

  if (row) {
    return { unitPrice: Number(row.unitPrice), unitCost: Number(row.costPrice), source: 'snapshot' };
  }
  return { unitPrice: Number(product.unitPrice), unitCost: Number(product.costPrice), source: 'fallback_current' };
}

/** Prejuízo de venda de uma perda, para consultas com o alias `loss` (TypeORM traduz as propriedades). */
export const LOSS_REVENUE_SQL = 'loss.quantity * loss.unitPriceAtLoss';

/** Prejuízo de custo de uma perda, mesmo contrato de LOSS_REVENUE_SQL. */
export const LOSS_COST_SQL = 'loss.quantity * loss.unitCostAtLoss';

/** Mesmo cálculo de LOSS_REVENUE_SQL, para as funções puras (alertas, padrões suspeitos). */
export function lossValue(loss: Pick<Loss, 'quantity' | 'unitPriceAtLoss'>): number {
  return Number(loss.quantity) * Number(loss.unitPriceAtLoss ?? 0);
}

import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/** Correção retroativa de preço (SP2, etapa 2.3 — spec seção 4). */
export const RETRO_FIX_MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetroFixWindow {
  from: Date;
  to: Date;
}

export interface RetroFixImpact {
  affectedLosses: number;
  currentTotal: number;
  newTotal: number;
  currentCostTotal: number;
  newCostTotal: number;
}

/** Janela [from, to ?? agora]; limita o tamanho da transação a 366 dias. */
export function resolveRetroFixWindow(from: string, to: string | undefined, now: Date): RetroFixWindow {
  const start = new Date(from);
  const end = to ? new Date(to) : now;
  if (start.getTime() > now.getTime()) throw new BadRequestException('A data inicial não pode ser futura.');
  if (end.getTime() < start.getTime()) throw new BadRequestException('A data final não pode ser anterior à inicial.');
  if (end.getTime() - start.getTime() > RETRO_FIX_MAX_DAYS * DAY_MS) {
    throw new BadRequestException(`A janela máxima é de ${RETRO_FIX_MAX_DAYS} dias por correção.`);
  }
  return { from: start, to: end };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Impacto numa consulta agregada: perdas do produto na janela, totais atuais e com os valores novos. */
export async function computeRetroFixImpact(
  manager: EntityManager,
  productId: string,
  window: RetroFixWindow,
  unitPrice: number,
  costPrice: number,
): Promise<RetroFixImpact> {
  const [row]: { n: number; qty: string | null; price: string | null; cost: string | null }[] = await manager.query(
    `SELECT count(*)::int AS n, sum(quantity) AS qty,
            sum(quantity * "unitPriceAtLoss") AS price, sum(quantity * "unitCostAtLoss") AS cost
       FROM losses WHERE "productId" = $1 AND "occurredAt" BETWEEN $2 AND $3`,
    [productId, window.from, window.to],
  );
  const quantity = Number(row?.qty ?? 0);
  return {
    affectedLosses: row?.n ?? 0,
    currentTotal: round2(Number(row?.price ?? 0)),
    newTotal: round2(quantity * unitPrice),
    currentCostTotal: round2(Number(row?.cost ?? 0)),
    newCostTotal: round2(quantity * costPrice),
  };
}

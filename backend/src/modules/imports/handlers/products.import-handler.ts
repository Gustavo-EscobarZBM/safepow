import { EntityManager } from 'typeorm';
import { priceChangeExceeds } from '../../approvals/approval-policies';
import { normalizeBarcode, normalizeName, normalizeSku, parseMoney } from '../engine/normalize';
import { ImportResourceHandler, MissingPage, PlanContext, RowPlan } from '../engine/types';

/** Handler de importação de produtos (SP3, spec 2.2–2.3 e 5). Chave: código de barras. */

export interface ExistingProduct {
  id: string;
  barcode: string;
  name: string;
  sku: string | null;
  unitPrice: number;
  costPrice: number;
  isActive: boolean;
  updatedAt: Date;
}

const PRICE_FIELDS = ['unitPrice', 'costPrice'] as const;
const PRICE_JUMP_PERCENT = 50;

const toCents = (value: number) => Math.round(value * 100);

function sameValue(field: string, a: unknown, b: unknown): boolean {
  if ((PRICE_FIELDS as readonly string[]).includes(field)) return toCents(Number(a)) === toCents(Number(b));
  return (a ?? null) === (b ?? null);
}

/** Variação ≥ 50% sobre um valor anterior > 0, ou queda a 0. */
function isPriceJump(from: number, to: number): boolean {
  const fromCents = toCents(from);
  if (!(fromCents > 0)) return false;
  const toValue = toCents(to);
  return toValue === 0 || Math.abs(toValue - fromCents) * 100 >= PRICE_JUMP_PERCENT * fromCents;
}

function plan(values: Record<string, unknown>, existing: ExistingProduct | undefined, ctx: PlanContext): RowPlan {
  const mapped = ctx.mappedFields.filter((f) => f !== 'barcode');
  const warnings: string[] = [];

  if (!existing) {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of mapped) {
      const value = values[field] ?? null;
      diff[field] = { from: null, to: (PRICE_FIELDS as readonly string[]).includes(field) ? (value ?? 0) : value };
    }
    const price = Number(diff.unitPrice?.to ?? 0);
    const cost = Number(diff.costPrice?.to ?? 0);
    if (price > 0 && cost > price) warnings.push('COST_ABOVE_PRICE');
    return { action: 'create', diff, warnings, sensitivePrice: false };
  }

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (!existing.isActive) diff.isActive = { from: false, to: true };
  for (const field of ctx.updateFields.filter((f) => mapped.includes(f))) {
    const next = values[field];
    // Célula vazia = "não informado": nunca apaga o valor que o produto já tem.
    if (next === null || next === undefined) continue;
    const current = existing[field as keyof ExistingProduct];
    if (!sameValue(field, current, next)) diff[field] = { from: current, to: next };
  }

  for (const field of PRICE_FIELDS) {
    const change = diff[field];
    if (change && isPriceJump(Number(change.from), Number(change.to))) {
      warnings.push('PRICE_JUMP');
      break;
    }
  }
  const finalPrice = Number(diff.unitPrice?.to ?? existing.unitPrice);
  const finalCost = Number(diff.costPrice?.to ?? existing.costPrice);
  if (finalPrice > 0 && finalCost > finalPrice) warnings.push('COST_ABOVE_PRICE');

  const sensitivePrice =
    ctx.priceThresholdPercent !== null &&
    priceChangeExceeds(
      existing,
      {
        unitPrice: diff.unitPrice ? Number(diff.unitPrice.to) : undefined,
        costPrice: diff.costPrice ? Number(diff.costPrice.to) : undefined,
      },
      ctx.priceThresholdPercent,
    );

  const changed = Object.keys(diff).length > 0;
  return {
    action: !existing.isActive ? 'reactivate' : changed ? 'update' : 'unchanged',
    diff: changed ? diff : null,
    warnings,
    sensitivePrice,
  };
}

/** Produtos ativos cujo código não veio (sem erro) na planilha do job. */
const MISSING_FROM = `
  FROM products p
 WHERE p."isActive"
   AND NOT EXISTS (SELECT 1 FROM import_rows r WHERE r."jobId" = $1 AND r.key = p.barcode AND r.action <> 'error')`;

export const productsImportHandler: ImportResourceHandler<ExistingProduct> = {
  resource: 'products',
  keyField: 'barcode',
  fields: [
    {
      key: 'barcode',
      label: 'Código de barras',
      required: true,
      updatable: false,
      synonyms: ['codigo de barras', 'cod barras', 'codbarras', 'ean', 'gtin', 'ean13', 'codigo ean', 'barcode'],
      normalize: normalizeBarcode,
    },
    {
      key: 'name',
      label: 'Nome',
      required: true,
      updatable: true,
      synonyms: ['nome', 'descricao', 'descricao do produto', 'produto', 'nome do produto'],
      normalize: normalizeName,
    },
    {
      key: 'sku',
      label: 'SKU',
      required: false,
      updatable: true,
      synonyms: ['sku', 'codigo interno', 'cod interno', 'referencia', 'ref', 'codigo do produto', 'codigo'],
      normalize: normalizeSku,
    },
    {
      key: 'unitPrice',
      label: 'Preço de venda',
      required: false,
      updatable: true,
      synonyms: ['preco de venda', 'preco venda', 'venda', 'preco', 'valor de venda', 'vlr venda', 'pvenda', 'preco unitario'],
      normalize: parseMoney,
    },
    {
      key: 'costPrice',
      label: 'Custo',
      required: false,
      updatable: true,
      synonyms: ['custo', 'preco de custo', 'valor de custo', 'vlr custo', 'pcusto', 'custo unitario'],
      normalize: parseMoney,
    },
  ],

  async loadExisting(manager: EntityManager, keys: string[]): Promise<Map<string, ExistingProduct>> {
    if (keys.length === 0) return new Map();
    const rows: ExistingProduct[] = await manager.query(
      `SELECT id, barcode, name, sku, "unitPrice", "costPrice", "isActive", "updatedAt"
         FROM products WHERE barcode = ANY($1)`,
      [keys],
    );
    return new Map(
      rows.map((row) => [row.barcode, { ...row, unitPrice: Number(row.unitPrice), costPrice: Number(row.costPrice) }]),
    );
  },

  plan,

  async countMissing(manager: EntityManager, jobId: string) {
    const [row]: { count: number; withHistory: number }[] = await manager.query(
      `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM losses l WHERE l."productId" = p.id))::int AS "withHistory"
       ${MISSING_FROM}`,
      [jobId],
    );
    return row;
  },

  async listMissing(manager: EntityManager, jobId: string, page: number, limit: number): Promise<MissingPage> {
    const items: MissingPage['items'] = await manager.query(
      `SELECT p.id, p.barcode AS key, p.name,
              EXISTS (SELECT 1 FROM losses l WHERE l."productId" = p.id) AS "hasLosses"
       ${MISSING_FROM}
       ORDER BY p.name, p.id LIMIT $2 OFFSET $3`,
      [jobId, limit, (page - 1) * limit],
    );
    const { count } = await this.countMissing(manager, jobId);
    return { items, total: count };
  },
};

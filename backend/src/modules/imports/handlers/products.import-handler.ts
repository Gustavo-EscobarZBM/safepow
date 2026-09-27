import { EntityManager } from 'typeorm';
import { priceChangeExceeds } from '../../approvals/approval-policies';
import { normalizeBarcode, normalizeName, normalizeSku, parseMoney } from '../engine/normalize';
import { AppliedRow, ApplyRow, ArchivedRecord, ImportResourceHandler, MissingPage, PlanContext, RowPlan } from '../engine/types';

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

/**
 * Produtos ativos cujo código não aparece na planilha do job. Linha com erro também conta como "veio": arquivar
 * um produto só porque a linha dele tinha um preço inválido seria destrutivo.
 */
const MISSING_FROM = `
  FROM products p
 WHERE p."isActive"
   AND NOT EXISTS (SELECT 1 FROM import_rows r WHERE r."jobId" = $1 AND r.key = p.barcode)`;

/** Colunas que a importação pode escrever (whitelist: os nomes entram no SQL). */
const WRITABLE_COLUMNS = ['name', 'sku', 'unitPrice', 'costPrice'] as const;

async function lockExisting(manager: EntityManager, keys: string[]): Promise<Map<string, ExistingProduct>> {
  if (keys.length === 0) return new Map();
  const rows: ExistingProduct[] = await manager.query(
    `SELECT id, barcode, name, sku, "unitPrice", "costPrice", "isActive", "updatedAt"
       FROM products WHERE barcode = ANY($1) FOR UPDATE`,
    [keys],
  );
  return new Map(rows.map((row) => [row.barcode, { ...row, unitPrice: Number(row.unitPrice), costPrice: Number(row.costPrice) }]));
}

function beforeOf(product: ExistingProduct): Record<string, unknown> {
  return {
    name: product.name,
    sku: product.sku,
    unitPrice: product.unitPrice,
    costPrice: product.costPrice,
    isActive: product.isActive,
    updatedAt: new Date(product.updatedAt).toISOString(),
  };
}

/** No TypeORM, UPDATE … RETURNING via manager.query devolve [linhas, contagem]; INSERT devolve só as linhas. */
function returned<T>(result: unknown): T[] {
  return (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];
}

const asText = (value: unknown) => (value === undefined || value === null ? null : String(value));
const asMoney = (value: unknown) => (value === undefined || value === null ? null : Number(value));

/**
 * Grava um lote (SP3, spec 2.5): relê e trava os produtos, recalcula a ação contra o estado ATUAL (o catálogo pode
 * ter mudado desde a simulação) e grava criações com INSERT e atualizações/reativações com UPDATE … FROM unnest.
 * Valor não informado (null) nunca sobrescreve: COALESCE com o valor atual. Criação que colide com um produto
 * criado por fora no meio do lote é recalculada como existente (até 2 passadas).
 */
async function applyBatch(
  manager: EntityManager,
  rows: ApplyRow[],
  ctx: { mappedFields: string[]; updateFields: string[] },
): Promise<AppliedRow[]> {
  const results = new Map<string, AppliedRow>();
  const columns = WRITABLE_COLUMNS.filter((c) => ctx.updateFields.includes(c) && ctx.mappedFields.includes(c));
  let pending = rows;
  for (let pass = 0; pass < 2 && pending.length; pass++) {
    const existing = await lockExisting(manager, pending.map((r) => r.key));
    const creates: ApplyRow[] = [];
    const updates: { row: ApplyRow; product: ExistingProduct; action: 'update' | 'reactivate' }[] = [];
    for (const row of pending) {
      const product = existing.get(row.key);
      const { action } = plan(row.values, product, { ...ctx, priceThresholdPercent: null });
      if (action === 'create') creates.push(row);
      else if (action === 'update' || action === 'reactivate') updates.push({ row, product: product!, action });
      else results.set(row.rowId, { rowId: row.rowId, entityId: product?.id ?? null, appliedAction: 'unchanged', before: null, updatedAt: null });
    }

    if (updates.length) {
      const set = columns.map((c) => `"${c}" = COALESCE(v."${c}", p."${c}")`).join(', ');
      const updated = returned<{ id: string; updatedAt: Date }>(await manager.query(
        `UPDATE products p
            SET ${set ? `${set}, ` : ''}"isActive" = true, "updatedAt" = clock_timestamp()
           FROM unnest($1::uuid[], $2::text[], $3::text[], $4::numeric[], $5::numeric[]) AS v(id, name, sku, "unitPrice", "costPrice")
          WHERE p.id = v.id
          RETURNING p.id, p."updatedAt"`,
        [
          updates.map((u) => u.product.id),
          updates.map((u) => asText(u.row.values.name)),
          updates.map((u) => asText(u.row.values.sku)),
          updates.map((u) => asMoney(u.row.values.unitPrice)),
          updates.map((u) => asMoney(u.row.values.costPrice)),
        ],
      ));
      const updatedAt = new Map(updated.map((u) => [u.id, u.updatedAt]));
      for (const { row, product, action } of updates) {
        results.set(row.rowId, {
          rowId: row.rowId,
          entityId: product.id,
          appliedAction: action,
          before: beforeOf(product),
          updatedAt: updatedAt.get(product.id) ?? null,
        });
      }
    }

    const conflicted: ApplyRow[] = [];
    if (creates.length) {
      const inserted: { id: string; barcode: string; updatedAt: Date }[] = await manager.query(
        `INSERT INTO products ("companyId", barcode, name, sku, "unitPrice", "costPrice", "updatedAt")
         SELECT NULLIF(current_setting('app.current_company_id', true), '')::uuid, v.barcode, v.name, v.sku,
                COALESCE(v."unitPrice", 0), COALESCE(v."costPrice", 0), clock_timestamp()
           FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::numeric[]) AS v(barcode, name, sku, "unitPrice", "costPrice")
         ON CONFLICT ("companyId", barcode) DO NOTHING
         RETURNING id, barcode, "updatedAt"`,
        [
          creates.map((r) => r.key),
          creates.map((r) => asText(r.values.name)),
          creates.map((r) => asText(r.values.sku)),
          creates.map((r) => asMoney(r.values.unitPrice)),
          creates.map((r) => asMoney(r.values.costPrice)),
        ],
      );
      const byKey = new Map(inserted.map((i) => [i.barcode, i]));
      for (const row of creates) {
        const created = byKey.get(row.key);
        if (created) {
          results.set(row.rowId, { rowId: row.rowId, entityId: created.id, appliedAction: 'create', before: null, updatedAt: created.updatedAt });
        } else {
          conflicted.push(row);
        }
      }
    }
    pending = conflicted;
  }
  for (const row of pending) {
    results.set(row.rowId, {
      rowId: row.rowId,
      entityId: null,
      appliedAction: 'error',
      before: null,
      updatedAt: null,
      error: 'O produto foi criado por outra pessoa durante a importação. Importe de novo.',
    });
  }
  return rows.map((row) => results.get(row.rowId)!);
}

async function archiveMissingBatch(manager: EntityManager, jobId: string, limit: number): Promise<ArchivedRecord[]> {
  const picked: ExistingProduct[] = await manager.query(
    `SELECT p.id, p.barcode, p.name, p.sku, p."unitPrice", p."costPrice", p."isActive", p."updatedAt"
     ${MISSING_FROM}
     ORDER BY p.id LIMIT $2 FOR UPDATE OF p`,
    [jobId, limit],
  );
  if (picked.length === 0) return [];
  const archived = returned<{ id: string; updatedAt: Date }>(await manager.query(
    `UPDATE products SET "isActive" = false, "updatedAt" = clock_timestamp() WHERE id = ANY($1) RETURNING id, "updatedAt"`,
    [picked.map((p) => p.id)],
  ));
  const updatedAt = new Map(archived.map((a) => [a.id, a.updatedAt]));
  return picked.map((p) => ({
    entityId: p.id,
    key: p.barcode,
    before: beforeOf({ ...p, unitPrice: Number(p.unitPrice), costPrice: Number(p.costPrice) }),
    updatedAt: updatedAt.get(p.id)!,
  }));
}

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

  applyBatch,

  archiveMissingBatch,
};

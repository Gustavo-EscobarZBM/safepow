import { EntityManager } from 'typeorm';
import { priceChangeExceeds } from '../../approvals/approval-policies';
import { CATEGORY_PATH_SEPARATOR, categoryPathMap } from '../../catalog/categories.service';
import {
  normalizeBarcode,
  normalizeCategoryPath,
  normalizeName,
  normalizeSku,
  normalizeUnit,
  parseBooleanPt,
  parseMoney,
  parseShelfLifeDays,
} from '../engine/normalize';
import {
  AppliedRow,
  ApplyRow,
  ArchivedRecord,
  ImportResourceHandler,
  MissingPage,
  NormalizeResult,
  PlanContext,
  RollbackPreview,
  RowPlan,
} from '../engine/types';

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
  // Dados de catálogo (SP4 4.1); os rótulos servem ao diff (o usuário vê nomes, não ids).
  categoryId?: string | null;
  brandId?: string | null;
  supplierId?: string | null;
  unit?: string;
  isPerishable?: boolean;
  shelfLifeDays?: number | null;
  categoryPath?: string | null;
  brandName?: string | null;
  supplierName?: string | null;
}

const PRICE_FIELDS = ['unitPrice', 'costPrice'] as const;
const PRICE_JUMP_PERCENT = 50;

/** Campo da planilha ⇒ rótulo atual do produto (taxonomias: comparadas por nome, sem diferenciar maiúsculas). */
const TAXONOMY_LABELS = { category: 'categoryPath', brand: 'brandName', supplier: 'supplierName' } as const;
type TaxonomyField = keyof typeof TAXONOMY_LABELS;
const isTaxonomy = (field: string): field is TaxonomyField => field in TAXONOMY_LABELS;

/** Nomes (minúsculos) que já existem na empresa, arquivados inclusive — o que faltar será criado na gravação. */
type KnownTaxonomies = Record<TaxonomyField, Set<string>>;

/** Nome de marca/fornecedor: espaços normalizados, sem a proteção de fórmula da exportação, com limite de tamanho. */
function normalizeTaxonomyName(maxLength: number, label: string) {
  return (text: string | null): NormalizeResult<string | null> => {
    const name = normalizeName(text).value;
    if (!text?.trim() || !name) return { value: null, errors: [], warnings: [] };
    if (name.length > maxLength) return { value: null, errors: [`${label} com mais de ${maxLength} caracteres.`], warnings: [] };
    return { value: name, errors: [], warnings: [] };
  };
}

const toCents = (value: number) => Math.round(value * 100);
const toUnits = (field: string, value: unknown) => Math.round(Number(value) * (field === 'costPrice' ? 10000 : 100));

function sameValue(field: string, a: unknown, b: unknown): boolean {
  if ((PRICE_FIELDS as readonly string[]).includes(field)) return toUnits(field, a) === toUnits(field, b);
  if (isTaxonomy(field)) return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
  return (a ?? null) === (b ?? null);
}

/** Valor como aparece no diff: o caminho da categoria vira "Mercearia > Bebidas". */
function shown(field: string, value: unknown): unknown {
  if (field === 'category' && Array.isArray(value)) return value.join(CATEGORY_PATH_SEPARATOR);
  return value;
}

function currentOf(field: string, existing: ExistingProduct): unknown {
  if (isTaxonomy(field)) return existing[TAXONOMY_LABELS[field]] ?? null;
  return existing[field as keyof ExistingProduct] ?? null;
}

const WILL_BE_CREATED: Record<TaxonomyField, string> = {
  category: 'CATEGORY_WILL_BE_CREATED',
  brand: 'BRAND_WILL_BE_CREATED',
  supplier: 'SUPPLIER_WILL_BE_CREATED',
};

function taxonomyWarnings(diff: Record<string, { from: unknown; to: unknown }>, known: KnownTaxonomies | undefined): string[] {
  if (!known) return [];
  return (Object.keys(WILL_BE_CREATED) as TaxonomyField[])
    .filter((field) => diff[field]?.to && !known[field].has(String(diff[field].to).toLowerCase()))
    .map((field) => WILL_BE_CREATED[field]);
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
      diff[field] = { from: null, to: (PRICE_FIELDS as readonly string[]).includes(field) ? (value ?? 0) : shown(field, value) };
    }
    const price = Number(diff.unitPrice?.to ?? 0);
    const cost = Number(diff.costPrice?.to ?? 0);
    if (price > 0 && cost > price) warnings.push('COST_ABOVE_PRICE');
    warnings.push(...taxonomyWarnings(diff, ctx.batch as KnownTaxonomies | undefined));
    return { action: 'create', diff, warnings, sensitivePrice: false };
  }

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (!existing.isActive) diff.isActive = { from: false, to: true };
  for (const field of ctx.updateFields.filter((f) => mapped.includes(f))) {
    const next = values[field];
    // Célula vazia = "não informado": nunca apaga o valor que o produto já tem.
    if (next === null || next === undefined) continue;
    const current = currentOf(field, existing);
    const target = shown(field, next);
    if (!sameValue(field, current, target)) diff[field] = { from: current, to: target };
  }
  warnings.push(...taxonomyWarnings(diff, ctx.batch as KnownTaxonomies | undefined));

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
 * um produto só porque a linha dele tinha um preço inválido seria destrutivo. Só entram produtos que já existiam
 * na simulação: o gerente nunca viu, na lista de ausentes, um produto que um colega criou depois.
 */
const MISSING_FROM = `
  FROM products p
 WHERE p."isActive"
   AND p."createdAt" <= COALESCE((SELECT j."simulatedAt" FROM import_jobs j WHERE j.id = $1), now())
   AND NOT EXISTS (SELECT 1 FROM import_rows r WHERE r."jobId" = $1 AND r.key = p.barcode)`;

/** Colunas do produto lidas pela importação (alias `p`); os nomes de marca/fornecedor vêm por subconsulta (FOR UPDATE OF p). */
const EXISTING_COLUMNS = `p.id, p.barcode, p.name, p.sku, p."unitPrice", p."costPrice", p."isActive", p."updatedAt",
  p."categoryId", p."brandId", p."supplierId", p.unit, p."isPerishable", p."shelfLifeDays",
  (SELECT b.name FROM brands b WHERE b.id = p."brandId") AS "brandName",
  (SELECT s.name FROM suppliers s WHERE s.id = p."supplierId") AS "supplierName"`;

async function hydrate(manager: EntityManager, rows: ExistingProduct[]): Promise<ExistingProduct[]> {
  const paths = rows.some((r) => r.categoryId) ? await categoryPathMap(manager) : new Map<string, string>();
  return rows.map((row) => ({
    ...row,
    unitPrice: Number(row.unitPrice),
    costPrice: Number(row.costPrice),
    categoryPath: row.categoryId ? (paths.get(row.categoryId) ?? null) : null,
  }));
}

async function selectExisting(manager: EntityManager, keys: string[], lock: boolean): Promise<Map<string, ExistingProduct>> {
  if (keys.length === 0) return new Map();
  const rows: ExistingProduct[] = await manager.query(
    `SELECT ${EXISTING_COLUMNS} FROM products p WHERE p.barcode = ANY($1) ${lock ? 'FOR UPDATE OF p' : ''}`,
    [keys],
  );
  return new Map((await hydrate(manager, rows)).map((row) => [row.barcode, row]));
}

const lockExisting = (manager: EntityManager, keys: string[]) => selectExisting(manager, keys, true);

/** O "antes" guardado para a reversão (3.4). Os campos de catálogo entram desde o SP4 4.1 (jobs antigos não os têm). */
function beforeOf(product: ExistingProduct): Record<string, unknown> {
  return {
    name: product.name,
    sku: product.sku,
    unitPrice: product.unitPrice,
    costPrice: product.costPrice,
    isActive: product.isActive,
    categoryId: product.categoryId ?? null,
    brandId: product.brandId ?? null,
    supplierId: product.supplierId ?? null,
    unit: product.unit ?? 'UN',
    isPerishable: product.isPerishable ?? false,
    shelfLifeDays: product.shelfLifeDays ?? null,
    updatedAt: new Date(product.updatedAt).toISOString(),
  };
}

type ResolvedIds = Map<string, Partial<Record<TaxonomyField, string>>>;

/** Colunas que a importação pode escrever (whitelist: os nomes entram no SQL), com o tipo do unnest. */
interface ColumnDef {
  field: string;
  column: string;
  sqlType: 'text' | 'numeric' | 'uuid' | 'boolean' | 'int';
  value(row: ApplyRow, ids: ResolvedIds): unknown;
  /** Valor na criação quando a planilha não informa. */
  insertDefault?: string;
}

const COLUMN_DEFS: ColumnDef[] = [
  { field: 'name', column: 'name', sqlType: 'text', value: (r) => asText(r.values.name) },
  { field: 'sku', column: 'sku', sqlType: 'text', value: (r) => asText(r.values.sku) },
  { field: 'unitPrice', column: 'unitPrice', sqlType: 'numeric', value: (r) => asMoney(r.values.unitPrice), insertDefault: '0' },
  { field: 'costPrice', column: 'costPrice', sqlType: 'numeric', value: (r) => asMoney(r.values.costPrice), insertDefault: '0' },
  { field: 'category', column: 'categoryId', sqlType: 'uuid', value: (r, ids) => ids.get(r.rowId)?.category ?? null },
  { field: 'brand', column: 'brandId', sqlType: 'uuid', value: (r, ids) => ids.get(r.rowId)?.brand ?? null },
  { field: 'supplier', column: 'supplierId', sqlType: 'uuid', value: (r, ids) => ids.get(r.rowId)?.supplier ?? null },
  { field: 'unit', column: 'unit', sqlType: 'text', value: (r) => asText(r.values.unit), insertDefault: `'UN'` },
  { field: 'isPerishable', column: 'isPerishable', sqlType: 'boolean', value: (r) => r.values.isPerishable ?? null, insertDefault: 'false' },
  { field: 'shelfLifeDays', column: 'shelfLifeDays', sqlType: 'int', value: (r) => r.values.shelfLifeDays ?? null },
];

const CURRENT_COMPANY = `NULLIF(current_setting('app.current_company_id', true), '')::uuid`;

/** Marcas/fornecedores por nome sem caixa: cria os que faltam e reativa os arquivados. Devolve nome minúsculo ⇒ id. */
async function resolveNamed(manager: EntityManager, table: 'brands' | 'suppliers', names: string[]): Promise<Map<string, string>> {
  const byLower = new Map<string, string>();
  for (const name of names) if (!byLower.has(name.toLowerCase())) byLower.set(name.toLowerCase(), name);
  if (byLower.size === 0) return new Map();
  await manager.query(
    `INSERT INTO ${table} ("companyId", name) SELECT ${CURRENT_COMPANY}, n FROM unnest($1::text[]) AS n ON CONFLICT DO NOTHING`,
    [[...byLower.values()]],
  );
  const rows: { id: string; name: string; isActive: boolean }[] = await manager.query(
    `SELECT id, name, "isActive" FROM ${table} WHERE lower(name) = ANY($1)`,
    [[...byLower.keys()]],
  );
  const archived = rows.filter((r) => !r.isActive).map((r) => r.id);
  if (archived.length) {
    await manager.query(`UPDATE ${table} SET "isActive" = true, "updatedAt" = now() WHERE id = ANY($1)`, [archived]);
  }
  return new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
}

/** Caminhos de categoria: cada nível é procurado (sem caixa) sob o pai, criado se faltar e reativado se arquivado. */
async function resolveCategoryPaths(manager: EntityManager, paths: string[][]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const node = new Map<string, string>();
  for (const path of paths) {
    const pathKey = path.join(CATEGORY_PATH_SEPARATOR).toLowerCase();
    if (result.has(pathKey)) continue;
    let parentId: string | null = null;
    for (const name of path) {
      const key = `${parentId ?? ''}|${name.toLowerCase()}`;
      let id = node.get(key);
      if (!id) {
        const find = async () =>
          (
            (await manager.query(
              `SELECT id, "isActive" FROM categories WHERE lower(name) = lower($1) AND "parentId" IS NOT DISTINCT FROM $2::uuid`,
              [name, parentId],
            )) as { id: string; isActive: boolean }[]
          )[0];
        let found = await find();
        if (!found) {
          await manager.query(
            `INSERT INTO categories ("companyId", name, "parentId") VALUES (${CURRENT_COMPANY}, $1, $2) ON CONFLICT DO NOTHING`,
            [name, parentId],
          );
          found = await find();
        }
        if (!found.isActive) {
          await manager.query(`UPDATE categories SET "isActive" = true, "updatedAt" = now() WHERE id = $1`, [found.id]);
        }
        id = found.id;
        node.set(key, id);
      }
      parentId = id;
    }
    result.set(pathKey, parentId!);
  }
  return result;
}

/** Troca os nomes de categoria/marca/fornecedor pelos ids, só nos campos que cada linha vai gravar. */
async function resolveTaxonomyIds(manager: EntityManager, targets: { row: ApplyRow; fields: string[] }[]): Promise<ResolvedIds> {
  const wanted = (field: TaxonomyField) => targets.filter((t) => t.fields.includes(field) && t.row.values[field] != null);
  const categories = await resolveCategoryPaths(manager, wanted('category').map((t) => t.row.values.category as string[]));
  const brands = await resolveNamed(manager, 'brands', wanted('brand').map((t) => String(t.row.values.brand)));
  const suppliers = await resolveNamed(manager, 'suppliers', wanted('supplier').map((t) => String(t.row.values.supplier)));

  const ids: ResolvedIds = new Map();
  const set = (rowId: string, field: TaxonomyField, id: string | undefined) => {
    if (id) ids.set(rowId, { ...ids.get(rowId), [field]: id });
  };
  for (const t of wanted('category')) {
    set(t.row.rowId, 'category', categories.get((t.row.values.category as string[]).join(CATEGORY_PATH_SEPARATOR).toLowerCase()));
  }
  for (const t of wanted('brand')) set(t.row.rowId, 'brand', brands.get(String(t.row.values.brand).toLowerCase()));
  for (const t of wanted('supplier')) set(t.row.rowId, 'supplier', suppliers.get(String(t.row.values.supplier).toLowerCase()));
  return ids;
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
  const updateDefs = COLUMN_DEFS.filter((d) => ctx.updateFields.includes(d.field) && ctx.mappedFields.includes(d.field));
  const unnestTypes = (first: 'uuid' | 'text') =>
    [`$1::${first}[]`, ...COLUMN_DEFS.map((d, i) => `$${i + 2}::${d.sqlType}[]`)].join(', ');
  const unnestNames = COLUMN_DEFS.map((d) => `"${d.column}"`).join(', ');
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

    const ids = await resolveTaxonomyIds(manager, [
      ...creates.map((row) => ({ row, fields: ctx.mappedFields })),
      ...updates.map(({ row }) => ({ row, fields: updateDefs.map((d) => d.field) })),
    ]);

    if (updates.length) {
      const set = updateDefs.map((d) => `"${d.column}" = COALESCE(v."${d.column}", p."${d.column}")`).join(', ');
      const updated = returned<{ id: string; updatedAt: Date }>(await manager.query(
        `UPDATE products p
            SET ${set ? `${set}, ` : ''}"isActive" = true, "updatedAt" = clock_timestamp()
           FROM unnest(${unnestTypes('uuid')}) AS v(id, ${unnestNames})
          WHERE p.id = v.id
          RETURNING p.id, p."updatedAt"`,
        [updates.map((u) => u.product.id), ...COLUMN_DEFS.map((d) => updates.map((u) => d.value(u.row, ids)))],
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
      const values = COLUMN_DEFS.map((d) => (d.insertDefault ? `COALESCE(v."${d.column}", ${d.insertDefault})` : `v."${d.column}"`));
      const inserted: { id: string; barcode: string; updatedAt: Date }[] = await manager.query(
        `INSERT INTO products ("companyId", barcode, ${unnestNames}, "updatedAt")
         SELECT ${CURRENT_COMPANY}, v.barcode, ${values.join(', ')}, clock_timestamp()
           FROM unnest(${unnestTypes('text')}) AS v(barcode, ${unnestNames})
         ON CONFLICT ("companyId", barcode) DO NOTHING
         RETURNING id, barcode, "updatedAt"`,
        [creates.map((r) => r.key), ...COLUMN_DEFS.map((d) => creates.map((r) => d.value(r, ids)))],
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
  const picked = await hydrate(
    manager,
    await manager.query(
      `SELECT ${EXISTING_COLUMNS}
       ${MISSING_FROM}
       ORDER BY p.id LIMIT $2 FOR UPDATE OF p`,
      [jobId, limit],
    ),
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
    before: beforeOf(p),
    updatedAt: updatedAt.get(p.id)!,
  }));
}

/**
 * Linhas da importação que a reversão pode desfazer (SP3, spec 2.6): aplicadas, ainda não revertidas, com ação que
 * mudou o catálogo. `conflict` = o produto mudou depois da importação (ou não existe mais) e fica como está.
 * O `appliedUpdatedAt` passou por um Date do JS (milissegundos) e o `updatedAt` tem microssegundos: tolerância < 1 ms.
 */
const ROLLBACK_ROWS = `
  FROM import_rows r
  LEFT JOIN products p ON p.id = r."productId"
 WHERE r."jobId" = $1 AND r."appliedAt" IS NOT NULL AND r."rolledBackAt" IS NULL
   AND r."appliedAction" IN ('create', 'update', 'reactivate', 'archive')`;
const ROLLBACK_CONFLICT = `(p.id IS NULL OR abs(extract(epoch FROM p."updatedAt" - r."appliedUpdatedAt")) >= 0.001)`;

async function rollbackPreview(manager: EntityManager, jobId: string, page: number, limit: number): Promise<RollbackPreview> {
  const [counts]: { restore: number; conflicts: number }[] = await manager.query(
    `SELECT count(*) FILTER (WHERE NOT ${ROLLBACK_CONFLICT})::int AS restore,
            count(*) FILTER (WHERE ${ROLLBACK_CONFLICT})::int AS conflicts
     ${ROLLBACK_ROWS}`,
    [jobId],
  );
  const items = await manager.query(
    `SELECT r.key, COALESCE(p.name, r.before->>'name', r.normalized->>'name') AS name, r."appliedAction",
            CASE WHEN p.id IS NULL THEN 'deleted' ELSE 'changed' END AS reason
     ${ROLLBACK_ROWS} AND ${ROLLBACK_CONFLICT}
     ORDER BY r.key, r.id LIMIT $2 OFFSET $3`,
    [jobId, limit, (page - 1) * limit],
  );
  return { restore: counts.restore, conflicts: counts.conflicts, items, total: counts.conflicts };
}

/**
 * O que a reversão desperta nas políticas do SP2, só entre as linhas que vão mesmo voltar (sem conflito): preço
 * voltando além do limite contra o preço ATUAL, e arquivamento (desfazer criação/reativação) de produto com perdas.
 */
async function countRollbackSensitive(
  manager: EntityManager,
  jobId: string,
  thresholdPercent: number | null,
): Promise<{ priceChange: number; archiveWithHistory: number }> {
  const exceeds = (field: 'unitPrice' | 'costPrice') => `(
    (r.before->>'${field}') IS NOT NULL
    AND round(p."${field}" * 100) > 0
    AND abs(round((r.before->>'${field}')::numeric * 100) - round(p."${field}" * 100)) * 100 > $2 * round(p."${field}" * 100))`;
  const [row]: { priceChange: number; archiveWithHistory: number }[] = await manager.query(
    `SELECT count(*) FILTER (WHERE $2::numeric IS NOT NULL AND r."appliedAction" IN ('update', 'reactivate')
                              AND (${exceeds('unitPrice')} OR ${exceeds('costPrice')}))::int AS "priceChange",
            count(*) FILTER (WHERE r."appliedAction" IN ('create', 'reactivate')
                              AND EXISTS (SELECT 1 FROM losses l WHERE l."productId" = p.id))::int AS "archiveWithHistory"
     ${ROLLBACK_ROWS} AND NOT ${ROLLBACK_CONFLICT}`,
    [jobId, thresholdPercent],
  );
  return row;
}

/**
 * Um lote da reversão (SP3, spec 2.6), na transação do worker: trava as linhas e os produtos, reconfere o conflito
 * no momento e desfaz — criado ⇒ arquiva; atualizado ⇒ volta nome/SKU/preços; reativado ⇒ volta os campos e arquiva;
 * arquivado (ausente) ⇒ reativa. Conflitos ficam como estão. Toda linha do lote sai marcada (`rolledBackAt`).
 */
async function rollbackBatch(manager: EntityManager, jobId: string, limit: number): Promise<{ restored: number; conflicts: number }> {
  const picked: { id: string }[] = await manager.query(
    `SELECT r.id FROM import_rows r
      WHERE r."jobId" = $1 AND r."appliedAt" IS NOT NULL AND r."rolledBackAt" IS NULL
        AND r."appliedAction" IN ('create', 'update', 'reactivate', 'archive')
      ORDER BY r.id LIMIT $2 FOR UPDATE`,
    [jobId, limit],
  );
  if (picked.length === 0) return { restored: 0, conflicts: 0 };
  const rowIds = picked.map((r) => r.id);
  await manager.query(
    `SELECT id FROM products WHERE id IN (SELECT "productId" FROM import_rows WHERE id = ANY($1)) ORDER BY id FOR UPDATE`,
    [rowIds],
  );
  const rows: { id: string; appliedAction: string; before: Record<string, unknown> | null; productId: string; conflict: boolean }[] =
    await manager.query(
      `SELECT r.id, r."appliedAction", r.before, r."productId", ${ROLLBACK_CONFLICT} AS conflict
         FROM import_rows r LEFT JOIN products p ON p.id = r."productId"
        WHERE r.id = ANY($1)`,
      [rowIds],
    );
  const restore = rows.filter((r) => !r.conflict);
  const byAction = (...actions: string[]) => restore.filter((r) => actions.includes(r.appliedAction));

  const fields = byAction('update', 'reactivate');
  if (fields.length) {
    // Campos de catálogo só voltam quando o "antes" os tem (jobs anteriores ao SP4 4.1 não guardavam).
    const catalog = (column: string) => `"${column}" = CASE WHEN v.has_catalog THEN v."${column}" ELSE p."${column}" END`;
    await manager.query(
      `UPDATE products p
          SET name = v.name, sku = v.sku, "unitPrice" = v."unitPrice", "costPrice" = v."costPrice",
              ${['categoryId', 'brandId', 'supplierId', 'unit', 'isPerishable', 'shelfLifeDays'].map(catalog).join(', ')},
              "isActive" = COALESCE(v.active, p."isActive"), "updatedAt" = clock_timestamp()
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::boolean[],
                     $7::boolean[], $8::uuid[], $9::uuid[], $10::uuid[], $11::text[], $12::boolean[], $13::int[])
              AS v(id, name, sku, "unitPrice", "costPrice", active,
                   has_catalog, "categoryId", "brandId", "supplierId", unit, "isPerishable", "shelfLifeDays")
        WHERE p.id = v.id`,
      [
        fields.map((r) => r.productId),
        fields.map((r) => asText(r.before?.name)),
        fields.map((r) => asText(r.before?.sku)),
        fields.map((r) => asMoney(r.before?.unitPrice)),
        fields.map((r) => asMoney(r.before?.costPrice)),
        fields.map((r) => (r.appliedAction === 'reactivate' ? false : null)),
        fields.map((r) => r.before?.unit !== undefined),
        fields.map((r) => r.before?.categoryId ?? null),
        fields.map((r) => r.before?.brandId ?? null),
        fields.map((r) => r.before?.supplierId ?? null),
        fields.map((r) => r.before?.unit ?? null),
        fields.map((r) => r.before?.isPerishable ?? null),
        fields.map((r) => r.before?.shelfLifeDays ?? null),
      ],
    );
  }
  const toggle = async (targets: typeof restore, active: boolean) => {
    if (!targets.length) return;
    await manager.query(`UPDATE products SET "isActive" = $2, "updatedAt" = clock_timestamp() WHERE id = ANY($1)`, [
      targets.map((r) => r.productId),
      active,
    ]);
  };
  await toggle(byAction('create'), false);
  await toggle(byAction('archive'), true);

  await manager.query(
    `UPDATE import_rows SET "rolledBackAt" = now(),
            "rollbackResult" = CASE WHEN id = ANY($2) THEN 'conflict' ELSE 'restored' END
      WHERE id = ANY($1)`,
    [rowIds, rows.filter((r) => r.conflict).map((r) => r.id)],
  );
  return { restored: restore.length, conflicts: rows.length - restore.length };
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
      normalize: (text) => parseMoney(text, { decimals: 4 }),
    },
    {
      key: 'category',
      label: 'Categoria',
      required: false,
      updatable: true,
      synonyms: ['categoria', 'grupo', 'departamento', 'secao', 'familia'],
      normalize: normalizeCategoryPath,
    },
    {
      key: 'brand',
      label: 'Marca',
      required: false,
      updatable: true,
      synonyms: ['marca', 'fabricante'],
      normalize: normalizeTaxonomyName(80, 'Marca'),
    },
    {
      key: 'supplier',
      label: 'Fornecedor',
      required: false,
      updatable: true,
      synonyms: ['fornecedor', 'fornec'],
      normalize: normalizeTaxonomyName(120, 'Fornecedor'),
    },
    {
      key: 'unit',
      label: 'Unidade',
      required: false,
      updatable: true,
      synonyms: ['unidade', 'un', 'und', 'unid', 'medida'],
      normalize: normalizeUnit,
    },
    {
      key: 'isPerishable',
      label: 'Perecível',
      required: false,
      updatable: true,
      synonyms: ['perecivel', 'pereciveis'],
      normalize: parseBooleanPt,
    },
    {
      key: 'shelfLifeDays',
      label: 'Validade (dias)',
      required: false,
      updatable: true,
      synonyms: ['validade', 'validade dias', 'validade (dias)', 'dias validade', 'prazo validade'],
      normalize: parseShelfLifeDays,
    },
  ],

  loadExisting: (manager: EntityManager, keys: string[]) => selectExisting(manager, keys, false),

  /** Nomes de categoria (caminho), marca e fornecedor que já existem — o resto aparece como "será criado". */
  async prepareBatch(manager: EntityManager): Promise<KnownTaxonomies> {
    const lower = (rows: { name: string }[]) => new Set(rows.map((r) => r.name.toLowerCase()));
    return {
      category: new Set([...(await categoryPathMap(manager)).values()].map((p) => p.toLowerCase())),
      brand: lower(await manager.query(`SELECT name FROM brands`)),
      supplier: lower(await manager.query(`SELECT name FROM suppliers`)),
    };
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

  async countActive(manager: EntityManager): Promise<number> {
    const [row]: { n: number }[] = await manager.query(`SELECT count(*)::int AS n FROM products WHERE "isActive"`);
    return row.n;
  },

  /**
   * Mesma regra do priceChangeExceeds (SP2): variação estritamente acima do limite, em centavos, sobre o preço
   * ATUAL do produto (> 0) — não o da simulação, que pode ter mudado até a confirmação. Só campos que a importação
   * vai escrever (updateFields) e valores informados na planilha.
   */
  async countSensitivePriceChanges(manager: EntityManager, jobId: string, thresholdPercent: number, updateFields: string[]): Promise<number> {
    const exceeds = (field: 'unitPrice' | 'costPrice') => `(
      '${field}' = ANY($3::text[])
      AND (r.normalized->>'${field}') IS NOT NULL
      AND round(p."${field}" * 100) > 0
      AND abs(round((r.normalized->>'${field}')::numeric * 100) - round(p."${field}" * 100)) * 100 > $2 * round(p."${field}" * 100))`;
    const [row]: { n: number }[] = await manager.query(
      `SELECT count(*)::int AS n
         FROM import_rows r
         JOIN products p ON p.barcode = r.key
        WHERE r."jobId" = $1 AND r.action NOT IN ('error', 'duplicate', 'archive')
          AND (${exceeds('unitPrice')} OR ${exceeds('costPrice')})`,
      [jobId, thresholdPercent, updateFields],
    );
    return row.n;
  },

  applyBatch,

  archiveMissingBatch,

  rollbackPreview,

  countRollbackSensitive,

  rollbackBatch,
};

import { EntityManager } from 'typeorm';
import { categoryPathMap } from '../catalog/categories.service';

/** Mesmo formato de reportByReason: uma linha por categoria/fornecedor (`id: null` = sem vínculo). */
export interface CatalogBreakdownRow {
  id: string | null;
  label: string;
  totalQuantity: string;
  totalFinancialLoss: string;
}

export type CategoryLevel = 'root' | 'leaf';

/** Valor congelado da perda (SP1) — mesma conta de LOSS_REVENUE_SQL, em SQL cru. */
const LOSS_VALUE = `l.quantity * l."unitPriceAtLoss"`;

function periodFilter(from?: string, to?: string): { sql: string; params: unknown[] } {
  return from && to ? { sql: `AND l."occurredAt" BETWEEN $1 AND $2`, params: [from, to] } : { sql: '', params: [] };
}

/**
 * Perdas por categoria (SP4 4.1). Usa a categoria ATUAL do produto (não congelada na perda). `root` soma as
 * subcategorias na categoria de primeiro nível; `leaf` mostra a categoria em que o produto está.
 */
export async function lossesByCategory(
  manager: EntityManager,
  level: CategoryLevel,
  from?: string,
  to?: string,
): Promise<CatalogBreakdownRow[]> {
  const period = periodFilter(from, to);
  const groupColumn = level === 'root' ? 'r."rootId"' : 'p."categoryId"';
  const rows: CatalogBreakdownRow[] = await manager.query(
    `WITH RECURSIVE roots AS (
       SELECT id, id AS "rootId" FROM categories WHERE "parentId" IS NULL
       UNION ALL
       SELECT c.id, roots."rootId" FROM categories c JOIN roots ON c."parentId" = roots.id
     )
     SELECT ${groupColumn} AS id, SUM(l.quantity) AS "totalQuantity", SUM(${LOSS_VALUE}) AS "totalFinancialLoss"
       FROM losses l
       JOIN products p ON p.id = l."productId"
       LEFT JOIN roots r ON r.id = p."categoryId"
      WHERE true ${period.sql}
      GROUP BY ${groupColumn}
      ORDER BY "totalFinancialLoss" DESC`,
    period.params,
  );
  const paths = await categoryPathMap(manager);
  return rows.map((row) => ({ ...row, label: row.id ? (paths.get(row.id) ?? '—') : 'Sem categoria' }));
}

/** Perdas por fornecedor principal ATUAL do produto (SP4 4.1). */
export async function lossesBySupplier(manager: EntityManager, from?: string, to?: string): Promise<CatalogBreakdownRow[]> {
  const period = periodFilter(from, to);
  return manager.query(
    `SELECT s.id, COALESCE(s.name, 'Sem fornecedor') AS label,
            SUM(l.quantity) AS "totalQuantity", SUM(${LOSS_VALUE}) AS "totalFinancialLoss"
       FROM losses l
       JOIN products p ON p.id = l."productId"
       LEFT JOIN suppliers s ON s.id = p."supplierId"
      WHERE true ${period.sql}
      GROUP BY s.id, s.name
      ORDER BY "totalFinancialLoss" DESC`,
    period.params,
  );
}

/** Maior página do sync (spec do SP1, 6.1). */
export const SYNC_MAX_LIMIT = 10000;

/**
 * Cursor de continuação do sync: "<updatedAt com microssegundos, UTC>|<id>". Precisão total de propósito
 * (R5): uma importação grava milhares de produtos com o MESMO updatedAt; um cursor truncado em
 * milissegundos (Date do JavaScript) reentregaria sempre a mesma página.
 */
export const SYNC_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Expressão SQL que formata um timestamptz com microssegundos em UTC (mesmo formato do cursor). */
export function SYNC_TIMESTAMP_SQL(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function formatSyncCursor(updatedAtUs: string, id: string): string {
  return `${updatedAtUs}|${id}`;
}

export function parseSyncCursor(cursor: string): { afterAt: string; afterId: string } {
  const [afterAt, afterId] = cursor.split('|');
  return { afterAt, afterId };
}

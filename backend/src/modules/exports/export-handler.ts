import { EntityManager } from 'typeorm';

export type ExportCellType = 'text' | 'money' | 'datetime';
export type ExportFormat = 'xlsx' | 'csv';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['xlsx', 'csv'];

export interface ExportColumn<R> {
  header: string;
  type: ExportCellType;
  width?: number;
  value(row: R): string | number | Date | null;
}

/**
 * Um recurso exportável (SP3, spec 4): as colunas e como ler as linhas em páginas por keyset de `id`
 * (`ORDER BY id`, `id > afterId`). A contagem vem antes, para recusar exportações grandes demais sem abrir a resposta.
 */
export interface ExportResourceHandler<R extends { id: string }, F = unknown> {
  fileBase: string;
  sheetName: string;
  columns: ExportColumn<R>[];
  count(manager: EntityManager, filters: F): Promise<number>;
  page(manager: EntityManager, filters: F, afterId: string | null, limit: number): Promise<R[]>;
}

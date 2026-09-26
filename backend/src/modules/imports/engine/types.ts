/** Contratos do motor de importação (SP3, spec 5). */
export type { RowAction } from '../import-job.entity';

export interface NormalizeResult<T = unknown> {
  value: T;
  errors: string[];
  warnings: string[];
}

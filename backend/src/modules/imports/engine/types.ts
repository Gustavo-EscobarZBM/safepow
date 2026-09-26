import { EntityManager } from 'typeorm';
import { RowAction } from '../import-job.entity';

/** Contratos do motor de importação (SP3, spec 5). O motor não conhece `products`: fala com um handler. */
export type { RowAction };

export interface NormalizeResult<T = unknown> {
  value: T;
  errors: string[];
  warnings: string[];
}

export interface ImportFieldDef {
  key: string;
  label: string;
  required: boolean;
  /** Pode ser escolhido em "campos a atualizar em registros existentes" (a chave nunca). */
  updatable: boolean;
  synonyms: string[];
  normalize(text: string | null): NormalizeResult;
}

export interface RowPlan {
  action: RowAction;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  warnings: string[];
  sensitivePrice: boolean;
}

export interface PlanContext {
  mappedFields: string[];
  updateFields: string[];
  /** Limite da política price_change; `null` = política desligada. */
  priceThresholdPercent: number | null;
}

export interface MissingPage {
  items: { id: string; key: string; name: string; hasLosses: boolean }[];
  total: number;
}

export interface ImportResourceHandler<E = unknown> {
  resource: string;
  keyField: string;
  fields: ImportFieldDef[];
  loadExisting(manager: EntityManager, keys: string[]): Promise<Map<string, E>>;
  plan(values: Record<string, unknown>, existing: E | undefined, ctx: PlanContext): RowPlan;
  countMissing(manager: EntityManager, jobId: string): Promise<{ count: number; withHistory: number }>;
  listMissing(manager: EntityManager, jobId: string, page: number, limit: number): Promise<MissingPage>;
}

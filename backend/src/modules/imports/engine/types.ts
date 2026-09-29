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
  /** O que `prepareBatch` devolveu para o lote (só na simulação). */
  batch?: unknown;
}

export interface MissingPage {
  items: { id: string; key: string; name: string; hasLosses: boolean }[];
  total: number;
}

/** Linha simulada pronta para gravar. */
export interface ApplyRow {
  rowId: string;
  key: string;
  values: Record<string, unknown>;
}

/** Resultado da gravação de uma linha: a ação efetivamente aplicada contra o catálogo do momento. */
export interface AppliedRow {
  rowId: string;
  entityId: string | null;
  appliedAction: RowAction;
  before: Record<string, unknown> | null;
  updatedAt: Date | null;
  error?: string;
}

export interface ArchivedRecord {
  entityId: string;
  key: string;
  before: Record<string, unknown>;
  updatedAt: Date;
}

/** Registro que mudou depois da importação e por isso fica como está na reversão. */
export interface RollbackConflict {
  key: string;
  name: string | null;
  appliedAction: RowAction;
  reason: 'changed' | 'deleted';
}

export interface RollbackPreview {
  /** Alterações que serão desfeitas. */
  restore: number;
  conflicts: number;
  /** Página dos conflitos. */
  items: RollbackConflict[];
  total: number;
}

export interface ImportResourceHandler<E = unknown> {
  resource: string;
  keyField: string;
  fields: ImportFieldDef[];
  loadExisting(manager: EntityManager, keys: string[]): Promise<Map<string, E>>;
  plan(values: Record<string, unknown>, existing: E | undefined, ctx: PlanContext): RowPlan;
  /**
   * Dados do banco que o plano de um lote precisa além dos registros da chave (ex.: nomes de categorias existentes,
   * para avisar "será criada"). Vai para `plan` em `ctx.batch`.
   */
  prepareBatch?(manager: EntityManager, rows: Record<string, unknown>[]): Promise<unknown>;
  countMissing(manager: EntityManager, jobId: string): Promise<{ count: number; withHistory: number }>;
  listMissing(manager: EntityManager, jobId: string, page: number, limit: number): Promise<MissingPage>;
  /** Registros ativos da empresa (base dos 20% da confirmação forte de "arquivar ausentes"). */
  countActive(manager: EntityManager): Promise<number>;
  /** Linhas cuja mudança de preço passa do limite da política contra o preço ATUAL (recontado na confirmação). */
  countSensitivePriceChanges(manager: EntityManager, jobId: string, thresholdPercent: number, updateFields: string[]): Promise<number>;
  /** Grava um lote na transação de `manager` (que já tem o contexto da empresa), recalculando cada ação. */
  applyBatch(manager: EntityManager, rows: ApplyRow[], ctx: { mappedFields: string[]; updateFields: string[] }): Promise<AppliedRow[]>;
  /** Arquiva até `limit` registros ativos ausentes da planilha do job. */
  archiveMissingBatch(manager: EntityManager, jobId: string, limit: number): Promise<ArchivedRecord[]>;
  /** Prévia da reversão: quantas alterações voltam e a página dos registros em conflito. */
  rollbackPreview(manager: EntityManager, jobId: string, page: number, limit: number): Promise<RollbackPreview>;
  /** Linhas da reversão que despertam políticas do SP2 (limite de preço nulo = política de preço desligada). */
  countRollbackSensitive(
    manager: EntityManager,
    jobId: string,
    thresholdPercent: number | null,
  ): Promise<{ priceChange: number; archiveWithHistory: number }>;
  /** Reverte até `limit` linhas na transação de `manager`; `{0, 0}` quando não há mais nada. */
  rollbackBatch(manager: EntityManager, jobId: string, limit: number): Promise<{ restored: number; conflicts: number }>;
}

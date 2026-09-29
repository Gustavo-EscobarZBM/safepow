import { csvLine } from '../../../common/csv';
import { RowAction } from './types';

/** Rótulos dos avisos (também usados pelo painel). */
export const WARNING_LABELS: Record<string, string> = {
  GTIN_LENGTH_SUSPECT: 'Tamanho de código suspeito (zero à esquerda perdido?)',
  GTIN_CHECK_DIGIT: 'Dígito verificador inválido',
  AMBIGUOUS_DECIMAL: 'Separador decimal ambíguo',
  PRICE_ROUNDED: 'Valor arredondado para 2 casas',
  NAME_TRUNCATED: 'Nome cortado em 200 caracteres',
  PRICE_JUMP: 'Variação de preço de 50% ou mais',
  COST_ABOVE_PRICE: 'Custo maior que o preço',
  DUPLICATE_IDENTICAL: 'Linha repetida (ignorada)',
  CATEGORY_WILL_BE_CREATED: 'Categoria será criada',
  BRAND_WILL_BE_CREATED: 'Marca será criada',
  SUPPLIER_WILL_BE_CREATED: 'Fornecedor será criado',
};

export interface ReportRow {
  rowNumber: number | null;
  key: string | null;
  name?: string | null;
  action: RowAction;
  errors: string[];
  warnings: string[];
  raw: Record<string, string | null> | null;
}

function situation(row: ReportRow): string {
  if (row.action === 'error') return 'Erro';
  if (row.action === 'duplicate') return 'Repetida';
  return 'Aviso';
}

/** CSV completo de erros e avisos da simulação (SP3, spec 2.3): `;`, CRLF, BOM, células protegidas. */
export function buildImportReportCsv(headers: string[], rows: ReportRow[]): string {
  const lines = [csvLine(['Linha', 'Código de barras', 'Nome', 'Situação', 'Erros', 'Avisos', ...headers])];
  for (const row of rows) {
    lines.push(
      csvLine([
        row.rowNumber,
        row.key,
        row.name ?? null,
        situation(row),
        row.errors.join(' | '),
        row.warnings.map((code) => WARNING_LABELS[code] ?? code).join(' | '),
        ...headers.map((header) => row.raw?.[header] ?? null),
      ]),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

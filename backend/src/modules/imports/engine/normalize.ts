import type { CellValue } from 'exceljs';
import { NormalizeResult } from './types';

/**
 * Normalização de células da importação (SP3, spec 2.2 — corrige F9e/F9f). Funções puras: recebem o texto
 * da célula e devolvem o valor, os erros (a linha não entra) e os avisos (entra, mas o gerente é avisado).
 */

const MAX_BARCODE_LENGTH = 64;
const MAX_NAME_LENGTH = 200;
const MAX_SKU_LENGTH = 60;
const MAX_MONEY = 1e10; // numeric(12,2)

function ok<T>(value: T, warnings: string[] = []): NormalizeResult<T> {
  return { value, errors: [], warnings };
}

function fail<T>(value: T, error: string): NormalizeResult<T> {
  return { value, errors: [error], warnings: [] };
}

/** Valor bruto de uma célula do exceljs ⇒ texto. Nunca `String(value)` (daria "[object Object]"). */
export function cellToText(value: CellValue | undefined): { text: string | null; error?: string } {
  if (value === null || value === undefined || value === '') return { text: null };
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      // EAN numérico: sem notação científica nem ".0".
      return { text: Number.isSafeInteger(value) ? String(value) : BigInt(value).toString() };
    }
    return { text: String(value) };
  }
  if (typeof value === 'boolean') return { text: String(value) };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10) };

  const object = value as unknown as Record<string, unknown>;
  if ('error' in object) return { text: null, error: `Célula com erro (${String(object.error)}).` };
  if ('richText' in object && Array.isArray(object.richText)) {
    return { text: (object.richText as { text: string }[]).map((part) => part.text).join('') || null };
  }
  if ('formula' in object || 'sharedFormula' in object) {
    return cellToText(object.result as CellValue | undefined);
  }
  if ('hyperlink' in object) return cellToText(object.text as CellValue | undefined);
  if ('text' in object) return cellToText(object.text as CellValue | undefined);
  return { text: null };
}

export function gtinCheckDigitValid(digits: string): boolean {
  const payload = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[payload.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

export function normalizeBarcode(text: string | null): NormalizeResult<string | null> {
  const trimmed = (text ?? '').trim();
  // CSV salvo pelo Excel grava o texto exibido: EAN em coluna "Geral" sai como 7,89123E+12, sem os dígitos.
  if (/^\d+([.,]\d+)?E[+-]?\d+$/i.test(trimmed)) {
    return fail(null, 'Código em notação científica: o Excel cortou os dígitos. Formate a coluna como Texto e exporte de novo.');
  }
  const code =/^[\d\s.-]+$/.test(trimmed) ? trimmed.replace(/\D/g, '') : trimmed;
  if (!code) return fail(null, 'Código de barras vazio.');
  if (code.length > MAX_BARCODE_LENGTH) return fail(null, `Código de barras com mais de ${MAX_BARCODE_LENGTH} caracteres.`);
  if (!/^\d+$/.test(code)) return ok(code);
  if (code.length === 7 || code.length === 11) return ok(code, ['GTIN_LENGTH_SUSPECT']);
  if ([8, 12, 13, 14].includes(code.length) && !gtinCheckDigitValid(code)) return ok(code, ['GTIN_CHECK_DIGIT']);
  return ok(code);
}

/**
 * Preço/custo: aceita `12,50`, `1.234,56`, `R$ 12,50`, `12.5`. Com `.` e `,`, o que aparece por último é o
 * decimal; um separador sozinho, se aparece uma vez, é decimal, e se aparece mais de uma, é de milhar.
 * Arredonda para 2 casas pelo TEXTO (12,345 ⇒ 12,35 — em ponto flutuante daria 12,34).
 */
export function parseMoney(text: string | null, opts: { decimals?: 2 | 4 } = {}): NormalizeResult<number | null> {
  const decimals = opts.decimals ?? 2;
  const scale = 10 ** decimals;
  // numeric(12,2) cabe até 1e10; numeric(12,4) (custo, SP4 4.1) até 1e8.
  const maxMoney = decimals === 4 ? 1e8 : MAX_MONEY;
  const original = (text ?? '').trim();
  if (!original) return ok(null);
  const invalid = () => fail(null, `Preço inválido: "${original}".`);

  let s = original.replace(/R\$/gi, '').replace(/[\s ]/g, '');
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return invalid();

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let decimal: '.' | ',' | null = null;
  if (dots && commas) decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (commas === 1) decimal = ',';
  else if (dots === 1) decimal = '.';

  const warnings: string[] = [];
  let intPart = s;
  let fracPart = '';
  if (decimal) {
    const at = s.lastIndexOf(decimal);
    intPart = s.slice(0, at);
    fracPart = s.slice(at + 1);
    if (decimal === '.' && !commas && fracPart.length === 3) warnings.push('AMBIGUOUS_DECIMAL');
  }
  intPart = intPart.replace(/[.,]/g, '') || '0';
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) return invalid();
  if (negative) return fail(null, `Preço negativo: "${original}".`);

  let units = Number(intPart) * scale + Number(fracPart.slice(0, decimals).padEnd(decimals, '0'));
  if (fracPart.length > decimals) {
    if (Number(fracPart[decimals]) >= 5) units += 1;
    warnings.push('PRICE_ROUNDED');
  }
  const value = units / scale;
  if (value >= maxMoney) return fail(null, `Preço acima do limite: "${original}".`);
  return ok(value, warnings);
}

/**
 * Desfaz a proteção de fórmula da exportação (`common/csv.ts#protectFormula`): `'-10% Sabão` volta a `-10% Sabão`,
 * para exportar → reimportar não mudar o nome. Só quando o apóstrofo vem antes de = + - @ (tab/CR já foram aparados).
 */
export function unprotectFormula(text: string): string {
  return /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
}

export function normalizeName(text: string | null): NormalizeResult<string | null> {
  const name = unprotectFormula((text ?? '').replace(/\s+/g, ' ').trim());
  if (!name) return fail(null, 'Nome do produto vazio.');
  if (name.length > MAX_NAME_LENGTH) return ok(name.slice(0, MAX_NAME_LENGTH), ['NAME_TRUNCATED']);
  return ok(name);
}

const MAX_CATEGORY_LEVELS = 3;
const MAX_CATEGORY_NAME_LENGTH = 80;

/** "Mercearia > Bebidas" ou "Mercearia/Bebidas" ⇒ ['Mercearia', 'Bebidas'] (SP4 4.1). */
export function normalizeCategoryPath(text: string | null): NormalizeResult<string[] | null> {
  const parts = unprotectFormula((text ?? '').trim())
    .split(/[>/]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length === 0) return ok(null);
  if (parts.length > MAX_CATEGORY_LEVELS) return fail(null, `Categoria com mais de ${MAX_CATEGORY_LEVELS} níveis.`);
  if (parts.some((p) => p.length > MAX_CATEGORY_NAME_LENGTH)) {
    return fail(null, `Categoria com mais de ${MAX_CATEGORY_NAME_LENGTH} caracteres.`);
  }
  return ok(parts);
}

const stripAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

const UNIT_SYNONYMS: Record<string, string> = {
  un: 'UN', und: 'UN', unid: 'UN', unidade: 'UN', pc: 'UN', peca: 'UN',
  kg: 'KG', quilo: 'KG', kilo: 'KG', quilograma: 'KG',
  g: 'G', gr: 'G', grama: 'G',
  l: 'L', lt: 'L', litro: 'L',
  ml: 'ML', mililitro: 'ML',
  cx: 'CX', caixa: 'CX',
  pct: 'PCT', pacote: 'PCT',
  dz: 'DZ', duzia: 'DZ',
  m: 'M', mt: 'M', metro: 'M',
};

export function normalizeUnit(text: string | null): NormalizeResult<string | null> {
  const original = (text ?? '').trim();
  if (!original) return ok(null);
  const unit = UNIT_SYNONYMS[stripAccents(original).toLowerCase().replace(/\.$/, '')];
  return unit ? ok(unit) : fail(null, `Unidade desconhecida: "${original}".`);
}

const TRUE_WORDS = ['sim', 's', 'x', '1', 'true'];
const FALSE_WORDS = ['nao', 'n', '0', 'false'];

export function parseBooleanPt(text: string | null): NormalizeResult<boolean | null> {
  const original = (text ?? '').trim();
  if (!original) return ok(null);
  const word = stripAccents(original).toLowerCase();
  if (TRUE_WORDS.includes(word)) return ok(true);
  if (FALSE_WORDS.includes(word)) return ok(false);
  return fail(null, `Valor inválido para Sim/Não: "${original}".`);
}

/** Validade em dias (SP4 4.1): inteiro ≥ 1; aceita "30 dias". */
export function parseShelfLifeDays(text: string | null): NormalizeResult<number | null> {
  const original = (text ?? '').trim();
  if (!original) return ok(null);
  const match = /^(\d+)(\s*dias?)?$/i.exec(original);
  const days = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(days) || days < 1) return fail(null, `Validade inválida: "${original}". Use o número de dias.`);
  return ok(days);
}

export function normalizeSku(text: string | null): NormalizeResult<string | null> {
  const sku = unprotectFormula((text ?? '').trim());
  if (!sku) return ok(null);
  if (sku.length > MAX_SKU_LENGTH) return fail(null, `SKU com mais de ${MAX_SKU_LENGTH} caracteres.`);
  return ok(sku);
}

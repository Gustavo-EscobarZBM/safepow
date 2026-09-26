import { createHash } from 'crypto';
import { ImportFieldDef } from './types';

/** Mapeamento sugerido e reconhecimento de planilhas já vistas (SP3, spec 2.1). */

/** Sem acento, minúsculo, só letras e dígitos: "  Cód. Barras " ⇒ "codbarras". */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Identifica "a mesma planilha do ERP" mesmo com colunas em outra ordem ou grafia levemente diferente. */
export function headerFingerprint(headers: string[]): string {
  const normalized = headers.map(normalizeHeader).filter(Boolean).sort();
  return createHash('sha256').update(normalized.join('\n')).digest('hex');
}

/** Campo ⇒ cabeçalho ORIGINAL; cada cabeçalho serve a no máximo um campo, na ordem dos campos. */
export function suggestMapping(headers: string[], fields: ImportFieldDef[]): Record<string, string> {
  const used = new Set<number>();
  const mapping: Record<string, string> = {};
  for (const field of fields) {
    const synonyms = new Set(field.synonyms.map(normalizeHeader));
    const index = headers.findIndex((header, i) => !used.has(i) && synonyms.has(normalizeHeader(header)));
    if (index >= 0) {
      used.add(index);
      mapping[field.key] = headers[index];
    }
  }
  return mapping;
}

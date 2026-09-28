/**
 * Nomes de produto/arquivo/pessoa são texto livre: começando com = + - @ (ou tab/CR) o Excel os leria como
 * fórmula. O apóstrofo faz o Excel tratar a célula como texto. Vale para CSV e xlsx.
 */
export function protectFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Célula de CSV (separador `;`) — usada pelos relatórios CSV (auditoria, importação, exportação). */
export function csvCell(value: unknown): string {
  const text = protectFormula(value === null || value === undefined ? '' : String(value));
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(';');
}

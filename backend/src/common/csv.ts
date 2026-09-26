/** Célula de CSV (separador `;`) — usada pelos relatórios CSV (auditoria, importação). */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Nomes de produto/arquivo/pessoa são texto livre: começando com = + - @ (ou tab/CR) o Excel os leria como
  // fórmula. O apóstrofo faz o Excel tratar a célula como texto.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(';');
}

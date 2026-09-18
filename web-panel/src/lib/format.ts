export function formatBRL(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', ...options });
}

export function formatDateShortBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

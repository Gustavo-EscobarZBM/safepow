export function formatBRL(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', ...options });
}

export function formatDateShortBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function formatDateTimeBR(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

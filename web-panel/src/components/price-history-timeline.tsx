import { formatBRL, formatDateTimeBR } from '@/lib/format';
import type { PriceChangeSource, PriceHistoryEntry } from '@/lib/types';

export const PRICE_SOURCE_LABELS: Record<PriceChangeSource, string> = {
  manual: 'Manual',
  import: 'Importação',
  bulk: 'Edição em massa',
  retro_fix: 'Correção retroativa',
  erp: 'ERP',
  approval: 'Aprovação',
  backfill: 'Registro inicial',
};

interface PriceHistoryTimelineProps {
  entries: PriceHistoryEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Linha do tempo de preços do produto (SP1, sub-etapa 1.2.4). Só apresentação: quem busca o histórico
 * é a página. As perdas guardam o preço vigente quando ocorreram — esta lista mostra de onde vem esse
 * valor.
 */
export function PriceHistoryTimeline({ entries, loading, error }: PriceHistoryTimelineProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Histórico de preços</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando histórico de preços...</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma mudança de preço registrada.</p>
      ) : (
        <ol aria-label="Histórico de preços" className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{formatBRL(entry.unitPrice)}</span>
                <span className="text-xs text-muted-foreground">{formatDateTimeBR(entry.validFrom)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Custo {formatBRL(entry.costPrice)} · {PRICE_SOURCE_LABELS[entry.source] ?? entry.source}
                {entry.changedByName ? ` · por ${entry.changedByName}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

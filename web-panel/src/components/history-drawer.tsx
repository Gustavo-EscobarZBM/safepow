'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { ACTION_LABELS, SOURCE_LABELS, buildAuditQuery, describeEntry } from '@/lib/audit';
import { formatDateTimeBR } from '@/lib/format';
import type { AuditLogEntry, AuditPage } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const HISTORY_PAGE_SIZE = 100;

interface HistoryDrawerProps {
  entityType: string;
  entityId: string | null;
  /** Nome do registro, mostrado no cabeçalho ("Histórico — Arroz 5kg"). */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Gaveta "Histórico" (SP2, 2.1.2): quem mudou o quê, quando e de onde, para UM registro. Busca sozinha
 * (GET /audit filtrado pela entidade) para ser reaproveitada por qualquer cadastro — inclusive o motor da 2.4.
 * Mostra as 100 mudanças mais recentes; o histórico completo fica na página Auditoria.
 */
export function HistoryDrawer({ entityType, entityId, title, open, onOpenChange }: HistoryDrawerProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chave da busca em andamento: resposta de um registro anterior (gaveta reaberta para outro) é descartada.
  const requestKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !entityId) return;
    const key = `${entityType}:${entityId}`;
    requestKey.current = key;
    setEntries([]);
    setError(null);
    setLoading(true);
    api
      .get<AuditPage>(`audit${buildAuditQuery({ entityType, entityId, pageSize: HISTORY_PAGE_SIZE })}`)
      .then((page) => {
        if (requestKey.current === key) setEntries(page.items);
      })
      .catch((e: unknown) => {
        if (requestKey.current === key) {
          setError(e instanceof ApiError ? e.message : 'Erro ao carregar o histórico.');
        }
      })
      .finally(() => {
        if (requestKey.current === key) setLoading(false);
      });
  }, [open, entityType, entityId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!top-0 !right-0 !left-auto !translate-x-0 !translate-y-0 flex h-dvh w-full flex-col rounded-none sm:!max-w-md">
        <DialogHeader>
          <DialogTitle>Histórico — {title}</DialogTitle>
          <DialogDescription>Quem alterou, quando, de onde e o que mudou.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando histórico...</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
        ) : (
          <ol aria-label="Histórico de alterações" className="flex-1 space-y-2 overflow-y-auto pr-1">
            {entries.map((entry) => {
              const lines = describeEntry(entry);
              return (
                <li key={entry.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTimeBR(entry.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.actorName ?? 'Sistema'} · {SOURCE_LABELS[entry.source] ?? entry.source}
                  </p>
                  {lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {lines.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {entry.reason && <p className="mt-1 text-xs italic">Justificativa: {entry.reason}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Pagination } from '@/components/pagination';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTimeBR } from '@/lib/format';
import { IMPORT_STATUS_LABELS, type ImportListItem, type ImportSummary, type Page } from '@/lib/imports';

const PAGE_SIZE = 20;

function resultText(summary: ImportSummary | null): string {
  if (!summary) return '—';
  const { create, update, error } = summary.counts;
  const parts = [`${create} ${create === 1 ? 'criado' : 'criados'}`, `${update} ${update === 1 ? 'atualizado' : 'atualizados'}`];
  if (error) parts.push(`${error} ${error === 1 ? 'erro' : 'erros'}`);
  return parts.join(' · ');
}

/** Histórico de importações (SP3, 3.2): cada linha abre o assistente no passo em que a importação está. */
export default function ImportsHistoryPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ImportListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    api
      .get<Page<ImportListItem>>(`imports?resource=products&page=${page}&limit=${PAGE_SIZE}`)
      .then((result) => {
        if (latestRequest.current !== requestId) return;
        setData(result);
        setError(null);
      })
      .catch((e) => {
        if (latestRequest.current !== requestId) return;
        setError(e instanceof ApiError ? e.message : 'Erro ao carregar as importações.');
      });
  }, [page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-foreground">Importações</h1>
          <p className="text-sm text-muted-foreground">Planilhas enviadas, com a situação e o resultado de cada uma.</p>
        </div>
        <Link
          href="/cadastros/importacoes/nova"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <FileSpreadsheet className="size-4" aria-hidden />
          Nova importação
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Card className="overflow-hidden p-0">
        {data && data.items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nenhuma importação ainda.</p>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Arquivo</th>
                  <th className="px-4 py-2 font-medium">Autor</th>
                  <th className="px-4 py-2 font-medium">Situação</th>
                  <th className="px-4 py-2 font-medium">Linhas</th>
                  <th className="px-4 py-2 font-medium">Resultado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="whitespace-nowrap px-4 py-2">{formatDateTimeBR(item.createdAt)}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2" title={item.fileName}>
                      {item.fileName}
                    </td>
                    <td className="px-4 py-2">{item.createdByName ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{IMPORT_STATUS_LABELS[item.status] ?? item.status}</Badge>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{item.summary?.totalRows ?? item.totalRows ?? '—'}</td>
                    <td className="px-4 py-2">{resultText(item.summary)}</td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/cadastros/importacoes/${item.id}`}
                        aria-label={`Abrir ${item.fileName}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
    </div>
  );
}

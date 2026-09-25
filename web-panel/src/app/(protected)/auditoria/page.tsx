'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  SOURCE_LABELS,
  buildAuditQuery,
  describeEntry,
  type AuditFilters,
} from '@/lib/audit';
import { formatDateTimeBR } from '@/lib/format';
import type { AuditLogEntry, AuditPage as AuditPageData } from '@/lib/types';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE_SIZE = 50;
// Ações que fazem sentido filtrar hoje (as de aprovação chegam na 2.2).
const FILTER_ACTIONS = ['create', 'update', 'archive', 'restore', 'delete', 'import', 'login', 'login_failed'];
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring';

type FilterForm = Pick<AuditFilters, 'entityType' | 'action' | 'from' | 'to'>;
const EMPTY_FILTERS: FilterForm = { entityType: '', action: '', from: '', to: '' };

/** Página Auditoria (SP2, 2.1.2): trilha completa da empresa, com filtros e exportação CSV. */
export default function AuditPage() {
  const [form, setForm] = useState<FilterForm>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<FilterForm>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AuditPageData>(`audit${buildAuditQuery({ ...filters, page, pageSize: PAGE_SIZE })}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleFilter(e: FormEvent) {
    e.preventDefault();
    setFilters(form);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.getBlob(`audit/export${buildAuditQuery(filters)}`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'auditoria.csv';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao exportar a auditoria.');
    } finally {
      setExporting(false);
    }
  }

  const items: AuditLogEntry[] = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Auditoria</h1>
          <p className="text-sm text-muted-foreground">
            Quem alterou o quê, quando e de onde — produtos, perdas, cadastros, usuários, acessos e importações.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Gerando...' : 'Exportar CSV'}
        </Button>
      </div>

      <Card className="p-4">
        <form onSubmit={handleFilter} className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="audit-entity">Entidade</Label>
            <select
              id="audit-entity"
              className={SELECT_CLASS}
              value={form.entityType}
              onChange={(e) => setForm({ ...form, entityType: e.target.value })}
            >
              <option value="">Todas</option>
              {Object.entries(ENTITY_LABELS)
                .filter(([key]) => key !== 'change_request')
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-action">Ação</Label>
            <select
              id="audit-action"
              className={SELECT_CLASS}
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
            >
              <option value="">Todas</option>
              {FILTER_ACTIONS.map((key) => (
                <option key={key} value={key}>
                  {ACTION_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-from">De</Label>
            <Input id="audit-from" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to">Até</Label>
            <Input id="audit-to" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </div>
          <Button type="submit">Filtrar</Button>
        </form>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/hora</TableHead>
              <TableHead>Pessoa</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead>Alterações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </TableCell>
              </TableRow>
            ) : (
              items.map((entry) => {
                const lines = describeEntry(entry);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTimeBR(entry.createdAt)}</TableCell>
                    <TableCell>{entry.actorName ?? 'Sistema'}</TableCell>
                    <TableCell>{SOURCE_LABELS[entry.source] ?? entry.source}</TableCell>
                    <TableCell>{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{ENTITY_LABELS[entry.entityType] ?? entry.entityType}</span>
                      {entry.entityLabel ? ` · ${entry.entityLabel}` : ''}
                    </TableCell>
                    <TableCell className="max-w-md text-xs">
                      {lines.length === 0 ? '—' : lines.map((line, index) => <div key={index}>{line}</div>)}
                      {entry.reason && <div className="italic">Justificativa: {entry.reason}</div>}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
    </div>
  );
}

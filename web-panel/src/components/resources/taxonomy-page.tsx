'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, Archive, History, Pencil, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import type { Category, Supplier } from '@/lib/types';
import { ExportButton } from '@/components/export-button';
import { HistoryDrawer } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArchiveDialog } from './archive-dialog';
import { ResourceFormDialog, type ResourceField } from './resource-form-dialog';
import { ResourceTable } from './resource-table';
import type { TaxonomyPageConfig } from './taxonomy-configs';

type TaxonomyItem = Supplier & Partial<Pick<Category, 'parentId' | 'path'>>;

const SEPARATOR = ' > ';
const MAX_LEVELS = 3;
const depthOf = (item: TaxonomyItem) => (item.path ?? item.name).split(SEPARATOR).length;

/**
 * Tela de Categorias, Marcas ou Fornecedores (SP4 4.1), sobre os blocos do motor de cadastros (SP2 2.4): abas
 * ativos/arquivados, criar/editar em janela, arquivar com confirmação, reativar, Histórico e Exportar.
 */
export function TaxonomyPage(config: TaxonomyPageConfig) {
  const { resource, singular } = config;
  const [items, setItems] = useState<TaxonomyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<TaxonomyItem | 'new' | null>(null);
  const [archiving, setArchiving] = useState<TaxonomyItem | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [forHistory, setForHistory] = useState<TaxonomyItem | null>(null);

  async function load() {
    setLoading(true);
    try {
      setItems(await api.get<TaxonomyItem[]>(`${resource}?includeArchived=true`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Erro ao carregar ${config.title.toLowerCase()}.`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  const rows = items.filter((item) => item.isActive === (tab === 'active'));
  const label = (item: TaxonomyItem) => (config.tree ? (item.path ?? item.name) : item.name);

  /** Pai possível: ativa, não a própria nem descendente, e sem estourar os 3 níveis. */
  const parentOptions = useMemo(() => {
    if (!config.tree) return [];
    const self = editing && editing !== 'new' ? editing : null;
    const selfPath = self ? label(self) : null;
    return items
      .filter((c) => c.isActive && c.id !== self?.id && depthOf(c) < MAX_LEVELS)
      .filter((c) => !selfPath || !label(c).startsWith(selfPath + SEPARATOR))
      .sort((a, b) => label(a).localeCompare(label(b), 'pt-BR'))
      .map((c) => ({ value: c.id, label: label(c) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, editing, config.tree]);

  const fields: ResourceField[] = config.tree
    ? [
        ...config.fields,
        {
          name: 'parentId',
          label: 'Categoria pai',
          type: 'select',
          options: [{ value: '', label: 'Nenhuma (categoria principal)' }, ...parentOptions],
        },
      ]
    : config.fields;

  const initialValues = useMemo(() => {
    const source = editing && editing !== 'new' ? editing : null;
    return Object.fromEntries(
      fields.map((f) => [f.name, String((source as Record<string, unknown> | null)?.[f.name] ?? '')]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, fields.length]);

  async function handleSubmit(values: Record<string, string>) {
    const body: Record<string, string | null> = {};
    for (const field of fields) {
      const value = (values[field.name] ?? '').trim();
      body[field.name] = value === '' && !field.required ? null : value;
    }
    if (editing === 'new') await api.post(resource, body);
    else if (editing) await api.patch(`${resource}/${editing.id}`, body);
    await load();
  }

  async function changeState(item: TaxonomyItem, action: 'archive' | 'restore') {
    setError(null);
    try {
      await api.post(`${resource}/${item.id}/${action}`, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Erro ao ${action === 'archive' ? 'arquivar' : 'reativar'} ${singular}.`);
    }
  }

  async function confirmArchive() {
    if (!archiving) return;
    setArchiveBusy(true);
    await changeState(archiving, 'archive');
    setArchiveBusy(false);
    setArchiving(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-foreground">{config.title}</h1>
          <p className="text-sm text-muted-foreground">{config.description}</p>
        </div>
        <div className="flex gap-2">
          <ExportButton path={`${resource}/export`} fileBase={config.fileBase} />
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" />
            {config.newLabel}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {(['active', 'archived'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tab === value ? 'default' : 'outline'}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {config.tabs[value]}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-hidden py-0">
        <ResourceTable
          columns={[
            { key: 'name', header: config.columnHeader, render: label, className: 'font-medium' },
            ...(config.extraColumns ?? []).map((column) => ({
              key: String(column.key),
              header: column.header,
              render: (item: TaxonomyItem) => String(item[column.key] ?? '—'),
            })),
          ]}
          rows={rows}
          loading={loading}
          emptyText={tab === 'active' ? config.emptyText : `Nada em ${config.tabs.archived.toLowerCase()}.`}
          actions={(item) => (
            <>
              <Button size="sm" variant="outline" aria-label={`Histórico de ${item.name}`} onClick={() => setForHistory(item)}>
                <History className="size-3.5" />
                Histórico
              </Button>
              {item.isActive ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(item)}>
                    <Pencil className="size-3.5" />
                    Editar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setArchiving(item)}>
                    <Archive className="size-3.5" />
                    Arquivar
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => changeState(item, 'restore')}>
                  <ArchiveRestore className="size-3.5" />
                  Reativar
                </Button>
              )}
            </>
          )}
        />
      </Card>

      <ResourceFormDialog
        open={editing !== null}
        title={editing === 'new' ? config.newLabel : `Editar ${singular}`}
        description={editing === 'new' ? `Preencha os dados e salve.` : 'Altere os dados e salve.'}
        fields={fields}
        initialValues={initialValues}
        submitLabel="Salvar"
        errorFallback={`Erro ao salvar ${singular}.`}
        onSubmit={handleSubmit}
        onOpenChange={(open) => !open && setEditing(null)}
      />

      <ArchiveDialog
        open={!!archiving}
        title={`Arquivar ${singular}?`}
        description={`"${archiving ? label(archiving) : ''}" deixa de aparecer para ser escolhida em novos cadastros. Os produtos que já a usam continuam como estão.`}
        confirming={archiveBusy}
        onConfirm={confirmArchive}
        onOpenChange={(open) => !open && setArchiving(null)}
      />

      <HistoryDrawer
        entityType={config.auditEntityType}
        entityId={forHistory?.id ?? null}
        title={forHistory ? label(forHistory) : ''}
        open={!!forHistory}
        onOpenChange={(open) => !open && setForHistory(null)}
      />
    </div>
  );
}

'use client';

import { FormEvent, useEffect, useState } from 'react';
import { History, Pencil, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { HistoryDrawer } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResourceFormDialog } from './resource-form-dialog';
import { ResourceTable } from './resource-table';

interface CatalogItem {
  id: string;
  name: string;
}

interface SimpleCatalogPageProps {
  resource: 'loss-reasons' | 'loss-locations';
  auditEntityType: 'loss_reason' | 'loss_location';
  title: string;
  description: string;
  itemLabel: string;
}

/**
 * Tela de "cadastrinho" (só nome): cadastro inline, tabela, editar, excluir e Histórico. Montada com os blocos do
 * motor de cadastros (SP2, 2.4) — substitui o antigo CatalogManager sem mudança visível além do botão Histórico.
 * Usada por Motivo da Perda e Local da Perda.
 */
export function SimpleCatalogPage({ resource, auditEntityType, title, description, itemLabel }: SimpleCatalogPageProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [itemToEdit, setItemToEdit] = useState<CatalogItem | null>(null);
  const [itemForHistory, setItemForHistory] = useState<CatalogItem | null>(null);

  const itemLabelLower = itemLabel.toLowerCase();

  async function load() {
    setLoading(true);
    try {
      setItems(await api.get<CatalogItem[]>(resource));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Erro ao carregar ${itemLabelLower}s.`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(resource, { name });
      setName('');
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : `Erro ao cadastrar ${itemLabelLower}.`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(values: Record<string, string>) {
    if (!itemToEdit) return;
    await api.patch(`${resource}/${itemToEdit.id}`, { name: values.name });
    await load();
  }

  async function handleDelete(item: CatalogItem) {
    setDeletingId(item.id);
    setError(null);
    try {
      await api.delete(`${resource}/${item.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Erro ao excluir ${itemLabelLower}.`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label>{itemLabel}</Label>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Nome do ${itemLabelLower}`}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Cadastrando...' : 'Cadastrar'}
            </Button>
          </form>
          {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-hidden py-0">
        <ResourceTable
          columns={[{ key: 'name', header: itemLabel, render: (item) => item.name, className: 'font-medium' }]}
          rows={items}
          loading={loading}
          emptyText={`Nenhum ${itemLabelLower} cadastrado ainda.`}
          actions={(item) => (
            <>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Histórico de ${item.name}`}
                title="Histórico"
                onClick={() => setItemForHistory(item)}
              >
                <History className="size-3.5" />
                Histórico
              </Button>
              <Button size="sm" variant="outline" onClick={() => setItemToEdit(item)}>
                <Pencil className="size-3.5" />
                Editar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleDelete(item)}
                disabled={deletingId === item.id}
              >
                <Trash2 className="size-3.5" />
                {deletingId === item.id ? 'Excluindo...' : 'Excluir'}
              </Button>
            </>
          )}
        />
      </Card>

      <ResourceFormDialog
        open={!!itemToEdit}
        title={`Editar ${itemLabelLower}`}
        description="Altere o nome e salve."
        fields={[{ name: 'name', label: itemLabel, required: true }]}
        initialValues={{ name: itemToEdit?.name ?? '' }}
        errorFallback={`Erro ao salvar ${itemLabelLower}.`}
        onSubmit={handleEdit}
        onOpenChange={(open) => !open && setItemToEdit(null)}
      />

      <HistoryDrawer
        entityType={auditEntityType}
        entityId={itemForHistory?.id ?? null}
        title={itemForHistory?.name ?? ''}
        open={!!itemForHistory}
        onOpenChange={(open) => !open && setItemForHistory(null)}
      />
    </div>
  );
}

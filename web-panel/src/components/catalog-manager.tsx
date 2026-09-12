'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CatalogItem {
  id: string;
  name: string;
}

/**
 * Tela genérica de "cadastrinho": input + botão cadastrar, tabela dos itens
 * já cadastrados, excluir por linha. Usada por Motivo da Perda e Local da
 * Perda (Cadastros) — mesmo CRUD simples nos dois casos, só muda o recurso.
 */
export function CatalogManager({
  resource,
  title,
  description,
  itemLabel,
}: {
  resource: 'loss-reasons' | 'loss-locations';
  title: string;
  description: string;
  itemLabel: string;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [itemToEdit, setItemToEdit] = useState<CatalogItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const itemLabelLower = itemLabel.toLowerCase();

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<CatalogItem[]>(resource);
      setItems(data);
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

  function openEdit(item: CatalogItem) {
    setItemToEdit(item);
    setEditName(item.name);
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!itemToEdit) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await api.patch(`${resource}/${itemToEdit.id}`, { name: editName });
      setItemToEdit(null);
      await load();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : `Erro ao salvar ${itemLabelLower}.`);
    } finally {
      setEditSubmitting(false);
    }
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{itemLabel}</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                  Nenhum {itemLabelLower} cadastrado ainda.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
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
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!itemToEdit} onOpenChange={(open) => !open && setItemToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {itemLabelLower}</DialogTitle>
            <DialogDescription>Altere o nome e salve.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{itemLabel}</Label>
              <Input required value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setItemToEdit(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

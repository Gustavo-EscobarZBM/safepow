'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Pencil, Smartphone, Monitor, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import type { Loss, LossLocationOption, LossReasonOption, Product, UserRole } from '@/lib/types';
import { Pagination, paginate } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const PAGE_SIZE = 20;

function SourceBadge({ source }: { source: Loss['source'] }) {
  if (source === 'mobile') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Smartphone className="size-3" /> App mobile
      </Badge>
    );
  }
  if (source === 'web') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Monitor className="size-3" /> Site
      </Badge>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR');
}

function toDateTimeLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function LossesClient({ role }: { role: UserRole }) {
  // Funcionário só registra — sem listagem, filtro ou exportação (Seção
  // pedida pelo usuário: "não visualizar mais nenhuma informação").
  const canViewHistory = role !== 'employee';
  // Editar/excluir perdas já registradas é exclusivo do gerente.
  const canManage = role === 'manager';

  const [losses, setLosses] = useState<Loss[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reasons, setReasons] = useState<LossReasonOption[]>([]);
  const [locations, setLocations] = useState<LossLocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);

  const emptyForm = {
    productId: '',
    quantity: '1',
    reasonId: '',
    locationId: '',
    occurredAt: toDateTimeLocal(new Date()),
    description: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);

  const [lossToEdit, setLossToEdit] = useState<Loss | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [lossToDelete, setLossToDelete] = useState<Loss | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Foto é enviada separadamente (multipart) para o object storage antes do
  // registro em si — mesmo fluxo já usado pelo app mobile (Seção 2.3).
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageToView, setImageToView] = useState<string | null>(null);

  function buildQuery() {
    const params = new URLSearchParams();
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function loadLosses() {
    setLoading(true);
    setPage(1);
    api
      .get<Loss[]>(`losses${buildQuery()}`)
      .then(setLosses)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (canViewHistory) loadLosses();
    api.get<Product[]>('products').then(setProducts).catch(() => undefined);
    api.get<LossReasonOption[]>('loss-reasons').then(setReasons).catch(() => undefined);
    api.get<LossLocationOption[]>('loss-locations').then(setLocations).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setJustRegistered(false);

    if (!form.productId || !form.reasonId || !form.locationId) {
      setFormError('Selecione produto, motivo e local antes de registrar.');
      return;
    }

    setSubmitting(true);
    try {
      let imageUrl: string | undefined;
      const imageFile = imageInputRef.current?.files?.[0];
      if (imageFile) {
        const imageFormData = new FormData();
        imageFormData.append('file', imageFile);
        const uploaded = await api.postForm<{ url: string }>('uploads/loss-image', imageFormData);
        imageUrl = uploaded.url;
      }

      const reasonName = reasons.find((r) => r.id === form.reasonId)?.name ?? '';
      await api.post('losses', {
        clientGeneratedId: crypto.randomUUID(),
        productId: form.productId,
        quantity: Number(form.quantity) || 1,
        reasonId: form.reasonId,
        locationId: form.locationId,
        occurredAt: new Date(form.occurredAt).toISOString(),
        description: form.description || reasonName,
        imageUrl,
        source: 'web',
      });
      setForm({ ...emptyForm, occurredAt: toDateTimeLocal(new Date()) });
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (canViewHistory) {
        await loadLosses();
      } else {
        setJustRegistered(true);
      }
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Erro ao registrar perda.');
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(loss: Loss) {
    setLossToEdit(loss);
    setEditForm({
      productId: loss.productId,
      quantity: String(loss.quantity),
      reasonId: loss.reasonId,
      locationId: loss.locationId,
      occurredAt: toDateTimeLocal(new Date(loss.occurredAt)),
      description: loss.description ?? '',
    });
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!lossToEdit) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await api.patch(`losses/${lossToEdit.id}`, {
        productId: editForm.productId,
        quantity: Number(editForm.quantity) || 1,
        reasonId: editForm.reasonId,
        locationId: editForm.locationId,
        occurredAt: new Date(editForm.occurredAt).toISOString(),
        description: editForm.description || undefined,
      });
      setLossToEdit(null);
      await loadLosses();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Erro ao salvar a perda.');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!lossToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`losses/${lossToDelete.id}`);
      setLossToDelete(null);
      await loadLosses();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Erro ao excluir a perda.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.getBlob(`losses/export${buildQuery()}`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'perdas.xlsx';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao exportar planilha.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-foreground">Perdas registradas</h1>
          <p className="text-sm text-muted-foreground">
            {canViewHistory
              ? 'Registros enviados pelo aplicativo ou pelo painel (mostrando os 500 mais recentes).'
              : 'Registre aqui um produto perdido, vencido ou danificado.'}
          </p>
        </div>
        {canViewHistory && (
          <Button onClick={handleExport} disabled={exporting} variant="outline">
            {exporting ? 'Gerando...' : 'Exportar planilha (.xlsx)'}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registrar perda</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Produto</Label>
              <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Quantidade</Label>
              <Input
                type="number"
                min="0.001"
                step="0.001"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Data/hora da ocorrência</Label>
              <Input
                type="datetime-local"
                value={form.occurredAt}
                onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Motivo da perda</Label>
              <Select value={form.reasonId} onValueChange={(v) => setForm({ ...form, reasonId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((reason) => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Local da perda</Label>
              <Select value={form.locationId} onValueChange={(v) => setForm({ ...form, locationId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o local" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ex: caixa amassada no transporte"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Foto (opcional)</Label>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-foreground hover:file:bg-accent/70"
              />
            </div>

            {formError && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{formError}</p>}
            {justRegistered && !formError && (
              <p className="text-sm text-emerald-600 sm:col-span-2 lg:col-span-3">
                Perda registrada com sucesso.
              </p>
            )}

            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Registrando...' : 'Registrar perda'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {canViewHistory && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-4">
              <div className="space-y-1">
                <Label>De</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
              </div>
              <div className="space-y-1">
                <Label>Até</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
              </div>
              <Button variant="outline" onClick={loadLosses}>
                Filtrar
              </Button>
              {(from || to) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFrom('');
                    setTo('');
                    setTimeout(loadLosses, 0);
                  }}
                >
                  Limpar filtro
                </Button>
              )}
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/hora</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Registrado por</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Foto</TableHead>
                  {canManage && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 10 : 9} className="py-6 text-center text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : losses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 10 : 9} className="py-6 text-center text-muted-foreground">
                      Nenhuma perda registrada ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginate(losses, page, PAGE_SIZE).map((loss) => (
                    <TableRow key={loss.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(loss.occurredAt)}</TableCell>
                      <TableCell>{loss.product?.name ?? loss.productId}</TableCell>
                      <TableCell>{Number(loss.quantity).toLocaleString('pt-BR')}</TableCell>
                      <TableCell>{loss.reason?.name ?? '—'}</TableCell>
                      <TableCell>{loss.location?.name ?? '—'}</TableCell>
                      <TableCell className="max-w-xs truncate" title={loss.description ?? undefined}>
                        {loss.description ?? '—'}
                      </TableCell>
                      <TableCell>{loss.reportedBy?.name ?? '—'}</TableCell>
                      <TableCell>
                        <SourceBadge source={loss.source} />
                      </TableCell>
                      <TableCell>
                        {loss.imageUrl ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Ver foto"
                            title="Ver foto"
                            onClick={() => setImageToView(loss.imageUrl)}
                          >
                            <ImageIcon className="size-4" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Editar perda"
                              title="Editar"
                              onClick={() => openEdit(loss)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Excluir perda"
                              title="Excluir"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                setLossToDelete(loss);
                                setDeleteError(null);
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(losses.length / PAGE_SIZE))}
              onChange={setPage}
            />
          </Card>
        </>
      )}

      <Dialog open={!!lossToEdit} onOpenChange={(open) => !open && setLossToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar perda</DialogTitle>
            <DialogDescription>Corrija os dados do registro e salve.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Produto</Label>
                <Select
                  value={editForm.productId}
                  onValueChange={(v) => setEditForm({ ...editForm, productId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data/hora da ocorrência</Label>
                <Input
                  type="datetime-local"
                  value={editForm.occurredAt}
                  onChange={(e) => setEditForm({ ...editForm, occurredAt: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Motivo da perda</Label>
                <Select
                  value={editForm.reasonId}
                  onValueChange={(v) => setEditForm({ ...editForm, reasonId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {reasons.map((reason) => (
                      <SelectItem key={reason.id} value={reason.id}>
                        {reason.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Local da perda</Label>
                <Select
                  value={editForm.locationId}
                  onValueChange={(v) => setEditForm({ ...editForm, locationId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o local" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Descrição (opcional)</Label>
                <Input
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLossToEdit(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!imageToView} onOpenChange={(open) => !open && setImageToView(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Foto da perda</DialogTitle>
          </DialogHeader>
          {imageToView && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageToView}
              alt="Foto da perda"
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!lossToDelete} onOpenChange={(open) => !open && setLossToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir perda</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir este registro de{' '}
              <strong>{lossToDelete?.product?.name ?? 'perda'}</strong>? Essa ação é permanente e não pode
              ser desfeita.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLossToDelete(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirmed} disabled={deleting}>
              {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

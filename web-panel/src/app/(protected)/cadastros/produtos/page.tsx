'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import type { ImportJob, Product } from '@/lib/types';
import { Pagination, paginate } from '@/components/pagination';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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

const PAGE_SIZE = 20;

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ barcode: '', name: '', unitPrice: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadProducts() {
    setLoading(true);
    try {
      const data = await api.get<Product[]>('products');
      setProducts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.barcode.toLowerCase().includes(term) ||
        (product.sku || '').toLowerCase().includes(term),
    );
  }, [products, search]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('products', {
        barcode,
        name,
        unitPrice: unitPrice ? Number(unitPrice) : undefined,
      });
      setBarcode('');
      setName('');
      setUnitPrice('');
      await loadProducts();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Erro ao cadastrar produto.');
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(product: Product) {
    setProductToEdit(product);
    setEditForm({
      barcode: product.barcode,
      name: product.name,
      unitPrice: String(product.unitPrice ?? ''),
    });
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!productToEdit) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await api.patch(`products/${productToEdit.id}`, {
        barcode: editForm.barcode,
        name: editForm.name,
        unitPrice: editForm.unitPrice ? Number(editForm.unitPrice) : undefined,
      });
      setProductToEdit(null);
      await loadProducts();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Erro ao salvar produto.');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!productToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`products/${productToDelete.id}`);
      setProductToDelete(null);
      await loadProducts();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao excluir produto.');
    } finally {
      setDeleting(false);
    }
  }

  // --- Importação de planilha (Seção 5 do documento) ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mappingBarcode, setMappingBarcode] = useState('Código de Barras');
  const [mappingName, setMappingName] = useState('Descrição');
  const [mappingPrice, setMappingPrice] = useState('Preço');
  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pollJobStatus(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.get<ImportJob>(`products/import/${jobId}`);
        setImportJob(job);
        if (job.status === 'completed' || job.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (job.status === 'completed') await loadProducts();
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
  }

  async function handleImportSubmit(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setImportError('Selecione um arquivo .xlsx.');
      return;
    }

    setUploading(true);
    setImportError(null);
    setImportJob(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append(
        'mapping',
        JSON.stringify({
          barcodeColumn: mappingBarcode,
          nameColumn: mappingName,
          unitPriceColumn: mappingPrice || undefined,
        }),
      );

      const { jobId } = await api.postForm<{ jobId: string }>('products/import', formData);
      pollJobStatus(jobId);
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'Erro ao enviar a planilha.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-foreground">Produtos</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro manual de produtos. Para cadastro em massa via planilha, veja a nota abaixo.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Código de barras</Label>
              <Input required value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Preço unitário (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>

            {formError && <p className="text-sm text-destructive sm:col-span-3">{formError}</p>}

            <div className="sm:col-span-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Cadastrando...' : 'Cadastrar produto'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Importar planilha de produtos</CardTitle>
          <CardDescription>
            Envie um arquivo .xlsx com o cadastro vindo do seu ERP. Informe abaixo os nomes exatos das
            colunas na sua planilha — isso permite reaproveitar planilhas com nomenclaturas diferentes de
            cada sistema (Seção 5.4 do documento de arquitetura).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleImportSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Coluna do código de barras</Label>
                <Input value={mappingBarcode} onChange={(e) => setMappingBarcode(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Coluna do nome/descrição</Label>
                <Input value={mappingName} onChange={(e) => setMappingName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Coluna do preço (opcional)</Label>
                <Input value={mappingPrice} onChange={(e) => setMappingPrice(e.target.value)} />
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-foreground hover:file:bg-accent/70"
            />

            {importError && <p className="text-sm text-destructive">{importError}</p>}

            <Button type="submit" disabled={uploading}>
              {uploading ? 'Enviando...' : 'Enviar planilha'}
            </Button>
          </form>

          {importJob && (
            <div className="mt-4 rounded-md border bg-muted/50 p-4 text-sm">
              <p className="font-medium">
                Status:{' '}
                {importJob.status === 'pending' && 'Aguardando processamento...'}
                {importJob.status === 'processing' && 'Processando...'}
                {importJob.status === 'completed' && 'Concluído'}
                {importJob.status === 'failed' && 'Falhou'}
              </p>
              {importJob.status === 'completed' && (
                <p className="mt-1 text-muted-foreground">
                  {importJob.successCount} de {importJob.totalRows} linhas importadas com sucesso
                  {importJob.errorCount > 0 && ` — ${importJob.errorCount} com erro`}.
                </p>
              )}
              {importJob.errorReport && importJob.errorReport.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-destructive">
                  {importJob.errorReport.map((err, i) => (
                    <li key={i}>
                      Linha {err.row}: {err.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por nome ou código de barras..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Código de barras</TableHead>
              <TableHead>Preço unitário</TableHead>
              <TableHead className="pr-6 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  {products.length === 0
                    ? 'Nenhum produto cadastrado ainda.'
                    : 'Nenhum produto encontrado para essa busca.'}
                </TableCell>
              </TableRow>
            ) : (
              paginate(filteredProducts, page, PAGE_SIZE).map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="font-mono text-xs">{product.barcode}</TableCell>
                  <TableCell>
                    {Number(product.unitPrice).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${product.name}`}
                        title="Editar"
                        onClick={() => openEdit(product)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${product.name}`}
                        title="Excluir"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setProductToDelete(product)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE))}
          onChange={setPage}
        />
      </Card>

      <Dialog open={!!productToEdit} onOpenChange={(open) => !open && setProductToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar produto</DialogTitle>
            <DialogDescription>Altere os dados de {productToEdit?.name} e salve.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Código de barras</Label>
                <Input
                  required
                  value={editForm.barcode}
                  onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Preço unitário (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.unitPrice}
                  onChange={(e) => setEditForm({ ...editForm, unitPrice: e.target.value })}
                />
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProductToEdit(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!productToDelete} onOpenChange={(open) => !open && setProductToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir produto</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{productToDelete?.name}</strong>? Ele deixará de
              aparecer no catálogo e no app dos funcionários, mas o histórico de perdas já registradas com
              ele é mantido.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductToDelete(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirmed} disabled={deleting}>
              {deleting ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

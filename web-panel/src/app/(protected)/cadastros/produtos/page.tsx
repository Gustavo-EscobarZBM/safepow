'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Search } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import type { ImportJob, PriceHistoryEntry, Product, ProductStatusFilter } from '@/lib/types';
import { PriceHistoryTimeline } from '@/components/price-history-timeline';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProductSearch } from './use-product-search';
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

export default function ProductsPage() {
  const productSearch = useProductSearch();
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');

  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ barcode: '', name: '', unitPrice: '', costPrice: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [priceHistory, setPriceHistory] = useState<{
    entries: PriceHistoryEntry[];
    loading: boolean;
    error: string | null;
  }>({ entries: [], loading: false, error: null });
  // Produto cujo histórico está sendo exibido: uma resposta que chegue depois de o gerente trocar de
  // produto é descartada, senão o diálogo do produto B mostraria os preços do A.
  const priceHistoryProductRef = useRef<string | null>(null);

  const [productToArchive, setProductToArchive] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('products', {
        barcode,
        name,
        unitPrice: unitPrice ? Number(unitPrice) : undefined,
        costPrice: costPrice ? Number(costPrice) : undefined,
      });
      setBarcode('');
      setName('');
      setUnitPrice('');
      setCostPrice('');
      productSearch.reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Erro ao cadastrar produto.');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadPriceHistory(productId: string) {
    priceHistoryProductRef.current = productId;
    setPriceHistory({ entries: [], loading: true, error: null });
    try {
      const entries = await api.get<PriceHistoryEntry[]>(`products/${productId}/price-history`);
      if (priceHistoryProductRef.current !== productId) return;
      setPriceHistory({ entries, loading: false, error: null });
    } catch (e) {
      if (priceHistoryProductRef.current !== productId) return;
      setPriceHistory({
        entries: [],
        loading: false,
        error: e instanceof ApiError ? e.message : 'Erro ao carregar o histórico de preços.',
      });
    }
  }

  function openEdit(product: Product) {
    setProductToEdit(product);
    setEditForm({
      barcode: product.barcode,
      name: product.name,
      unitPrice: String(product.unitPrice ?? ''),
      costPrice: String(product.costPrice ?? ''),
    });
    setEditError(null);
    void loadPriceHistory(product.id);
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
        costPrice: editForm.costPrice ? Number(editForm.costPrice) : undefined,
      });
      setProductToEdit(null);
      productSearch.reload();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Erro ao salvar produto.');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleArchiveConfirmed() {
    if (!productToArchive) return;
    setArchiving(true);
    setActionError(null);
    try {
      await api.delete(`products/${productToArchive.id}`);
      setProductToArchive(null);
      productSearch.reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Erro ao arquivar produto.');
    } finally {
      setArchiving(false);
    }
  }

  async function handleRestore(product: Product) {
    setRestoringId(product.id);
    setActionError(null);
    try {
      await api.patch(`products/${product.id}/restore`);
      productSearch.reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Erro ao reativar produto.');
    } finally {
      setRestoringId(null);
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
          if (job.status === 'completed') productSearch.reload();
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
          Cadastro manual de produtos. Para cadastro em massa via planilha, use a importação abaixo.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
            <div className="space-y-1.5">
              <Label>Preço de custo (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
              />
            </div>

            {formError && <p className="text-sm text-destructive sm:col-span-4">{formError}</p>}

            <div className="sm:col-span-4">
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

      {(productSearch.error || actionError) && (
        <p className="text-sm text-destructive">{actionError ?? productSearch.error}</p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={productSearch.status}
          onValueChange={(value) => productSearch.setStatus(value as ProductStatusFilter)}
        >
          <TabsList>
            <TabsTrigger value="active">Ativos</TabsTrigger>
            <TabsTrigger value="archived">Arquivados</TabsTrigger>
            <TabsTrigger value="all">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, código de barras ou SKU..."
            value={productSearch.search}
            onChange={(e) => productSearch.setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Código de barras</TableHead>
              <TableHead>Preço unitário</TableHead>
              <TableHead>Preço de custo</TableHead>
              <TableHead className="pr-6 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productSearch.loading && productSearch.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : productSearch.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {productSearch.search.trim()
                    ? 'Nenhum produto encontrado para essa busca.'
                    : productSearch.status === 'archived'
                      ? 'Nenhum produto arquivado.'
                      : 'Nenhum produto cadastrado ainda.'}
                </TableCell>
              </TableRow>
            ) : (
              productSearch.items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {product.name}
                      {!product.isActive && <Badge variant="secondary">Arquivado</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{product.barcode}</TableCell>
                  <TableCell>
                    {Number(product.unitPrice).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </TableCell>
                  <TableCell>
                    {Number(product.costPrice).toLocaleString('pt-BR', {
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
                      {product.isActive ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Arquivar ${product.name}`}
                          title="Arquivar"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setProductToArchive(product)}
                        >
                          <Archive className="size-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reativar ${product.name}`}
                          title="Reativar"
                          disabled={restoringId === product.id}
                          onClick={() => handleRestore(product)}
                        >
                          <ArchiveRestore className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pagination
          page={productSearch.page}
          totalPages={productSearch.totalPages}
          onChange={productSearch.setPage}
        />
      </Card>

      <Dialog open={!!productToEdit} onOpenChange={(open) => !open && setProductToEdit(null)}>
        {/* Com a linha do tempo de preços o diálogo passa da altura de um celular: limita e rola por
            dentro, senão o botão "Salvar" fica fora da tela. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
              <div className="space-y-1.5">
                <Label>Preço de custo (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.costPrice}
                  onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
                />
              </div>
            </div>
            <PriceHistoryTimeline {...priceHistory} />
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

      <Dialog open={!!productToArchive} onOpenChange={(open) => !open && setProductToArchive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar produto</DialogTitle>
            <DialogDescription>
              <strong>{productToArchive?.name}</strong> deixará de aparecer no app dos funcionários. O
              histórico de perdas registradas com ele é mantido, e você pode reativá-lo depois na aba
              Arquivados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductToArchive(null)} disabled={archiving}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleArchiveConfirmed} disabled={archiving}>
              {archiving ? 'Arquivando...' : 'Arquivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

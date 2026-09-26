'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { isPendingApproval } from '@/lib/approvals';
import { localDayBoundary } from '@/lib/audit';
import { formatBRL } from '@/lib/format';
import type { RetroFixImpact } from '@/lib/types';
import { MIN_JUSTIFICATION_LENGTH } from '@/components/justification-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RetroFixDialogProps {
  product: { id: string; name: string; unitPrice: number | string; costPrice: number | string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (outcome: 'applied' | 'pending', impact?: RetroFixImpact) => void;
}

/**
 * Correção retroativa de preço (SP2, 2.3): corrige o valor congelado das perdas de um período. Sempre mostra a
 * prévia do impacto antes de aplicar, e a justificativa é obrigatória (vai para a auditoria ou para o pedido).
 */
export function RetroFixDialog({ product, open, onOpenChange, onApplied }: RetroFixDialogProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [justification, setJustification] = useState('');
  const [impact, setImpact] = useState<RetroFixImpact | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cada prévia pedida (e cada mudança de parâmetro) avança o contador: resposta de uma prévia antiga é descartada.
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!open || !product) return;
    setFrom('');
    setTo('');
    setUnitPrice(String(Number(product.unitPrice)));
    setCostPrice(String(Number(product.costPrice)));
    setJustification('');
    setImpact(null);
    setError(null);
  }, [open, product]);

  // Qualquer mudança nos parâmetros invalida a prévia: o que se aplica é sempre o que se viu.
  function changeParam(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      previewSeq.current += 1;
      setImpact(null);
      setLoadingPreview(false);
    };
  }

  function params() {
    return {
      from: localDayBoundary(from, false),
      ...(to ? { to: localDayBoundary(to, true) } : {}),
      unitPrice: Number(unitPrice),
      costPrice: Number(costPrice),
    };
  }

  async function handlePreview() {
    if (!product) return;
    const seq = ++previewSeq.current;
    setLoadingPreview(true);
    setError(null);
    try {
      const query = new URLSearchParams(
        Object.entries(params()).map(([key, value]) => [key, String(value)]),
      ).toString();
      const result = await api.get<RetroFixImpact>(`products/${product.id}/retro-fix/preview?${query}`);
      if (seq === previewSeq.current) setImpact(result);
    } catch (e) {
      if (seq === previewSeq.current) setError(e instanceof ApiError ? e.message : 'Erro ao calcular o impacto.');
    } finally {
      if (seq === previewSeq.current) setLoadingPreview(false);
    }
  }

  async function handleApply(e: FormEvent) {
    e.preventDefault();
    if (!product || !canApply) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<RetroFixImpact>(`products/${product.id}/retro-fix`, {
        ...params(),
        justification: justification.trim(),
      });
      if (isPendingApproval(result)) onApplied('pending', undefined);
      else onApplied('applied', result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao aplicar a correção.');
    } finally {
      setSubmitting(false);
    }
  }

  const justificationLength = justification.trim().length;
  const canPreview = !!from && unitPrice !== '' && costPrice !== '' && !loadingPreview;
  const canApply = !!impact && impact.affectedLosses > 0 && justificationLength >= MIN_JUSTIFICATION_LENGTH && !submitting;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form className="space-y-4" onSubmit={handleApply}>
          <DialogHeader>
            <DialogTitle>Corrigir valores de perdas passadas</DialogTitle>
            <DialogDescription>
              Ajusta o valor das perdas de {product?.name ?? 'produto'} registradas no período. O preço atual do
              produto não muda.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="retro-from">De</Label>
              <Input id="retro-from" type="date" value={from} onChange={(e) => changeParam(setFrom)(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retro-to">Até</Label>
              <Input id="retro-to" type="date" value={to} onChange={(e) => changeParam(setTo)(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retro-price">Preço unitário (R$)</Label>
              <Input
                id="retro-price"
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => changeParam(setUnitPrice)(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retro-cost">Custo (R$)</Label>
              <Input
                id="retro-cost"
                type="number"
                min={0}
                step="0.01"
                value={costPrice}
                onChange={(e) => changeParam(setCostPrice)(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Sem "Até", corrige até agora. Máximo de 366 dias por vez.</p>
          <Button type="button" variant="outline" size="sm" disabled={!canPreview} onClick={handlePreview}>
            {loadingPreview ? 'Calculando...' : 'Ver impacto'}
          </Button>
          {impact && (
            <p role="status" className="rounded-md border px-3 py-2 text-sm">
              {impact.affectedLosses === 0
                ? 'Nenhuma perda no período.'
                : `${impact.affectedLosses} ${impact.affectedLosses === 1 ? 'perda' : 'perdas'}: ${formatBRL(
                    impact.currentTotal,
                  )} → ${formatBRL(impact.newTotal)} (custo ${formatBRL(impact.currentCostTotal)} → ${formatBRL(
                    impact.newCostTotal,
                  )})`}
            </p>
          )}
          <textarea
            aria-label="Justificativa"
            placeholder="Justificativa (obrigatória)"
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={1000}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          {justificationLength < MIN_JUSTIFICATION_LENGTH && (
            <p className="text-xs text-muted-foreground">
              {justificationLength}/{MIN_JUSTIFICATION_LENGTH} caracteres mínimos
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canApply}>
              {submitting ? 'Aplicando...' : 'Aplicar correção'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

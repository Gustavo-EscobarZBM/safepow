'use client';

import { useEffect, useState } from 'react';
import type { ApprovalMode } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const MIN_JUSTIFICATION_LENGTH = 10;

interface JustificationDialogProps {
  open: boolean;
  mode: ApprovalMode;
  /** Mensagem do backend (diz se vai para aprovação ou se basta justificar). */
  message: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

/**
 * Pede a justificativa de uma mudança sensível (SP2, 2.2). No modo aprovação o texto vira o motivo do pedido
 * que outro gerente vai ler; no modo justificativa, vai direto para a auditoria.
 */
export function JustificationDialog({ open, mode, message, submitting, error, onSubmit, onCancel }: JustificationDialogProps) {
  const [text, setText] = useState('');

  // Cada abertura começa em branco; um erro no envio NÃO fecha o diálogo, então o texto é preservado.
  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const usefulLength = text.trim().length;
  const tooShort = usefulLength < MIN_JUSTIFICATION_LENGTH;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onCancel()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort && !submitting) onSubmit(text.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Justifique a mudança</DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Justificativa"
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          {tooShort && (
            <p className="text-xs text-muted-foreground">
              {usefulLength}/{MIN_JUSTIFICATION_LENGTH} caracteres mínimos
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={tooShort || submitting}>
              {submitting ? 'Enviando...' : mode === 'approval' ? 'Enviar para aprovação' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

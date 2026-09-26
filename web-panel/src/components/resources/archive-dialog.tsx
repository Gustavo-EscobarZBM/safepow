'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ArchiveDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirming: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  confirmLabel?: string;
  confirmingLabel?: string;
}

/**
 * Confirmação de arquivar um registro (motor de cadastros, SP2 2.4). O texto explicativo vem de quem usa; o modo
 * "reativar" entra quando uma tela precisar dele com diálogo (SP5).
 */
export function ArchiveDialog({
  open,
  title,
  description,
  confirming,
  onConfirm,
  onOpenChange,
  confirmLabel = 'Arquivar',
  confirmingLabel = 'Arquivando...',
}: ArchiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={confirming}>
            {confirming ? confirmingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

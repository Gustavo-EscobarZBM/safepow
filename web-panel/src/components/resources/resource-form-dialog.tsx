'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
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

export interface ResourceField {
  name: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number';
}

interface ResourceFormDialogProps {
  open: boolean;
  title: string;
  description: string;
  fields: ResourceField[];
  initialValues: Record<string, string>;
  submitLabel?: string;
  submittingLabel?: string;
  errorFallback: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

/**
 * Criar/editar um registro de cadastro (motor de cadastros, SP2 2.4). O erro da API fica dentro do diálogo, que só
 * fecha no sucesso; enquanto envia, o botão fica desabilitado (sem envio duplicado).
 */
export function ResourceFormDialog({
  open,
  title,
  description,
  fields,
  initialValues,
  submitLabel = 'Salvar alterações',
  submittingLabel = 'Salvando...',
  errorFallback,
  onSubmit,
  onOpenChange,
}: ResourceFormDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guarda contra o 2º clique antes de o React re-renderizar o botão desabilitado.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
    setError(null);
    // Reinicia só a cada abertura (ou troca de registro), não a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(initialValues)]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorFallback);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={`resource-field-${field.name}`}>{field.label}</Label>
              <Input
                id={`resource-field-${field.name}`}
                type={field.type ?? 'text'}
                required={field.required}
                value={values[field.name] ?? ''}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              />
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? submittingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

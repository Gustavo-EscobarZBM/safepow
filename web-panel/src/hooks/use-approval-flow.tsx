'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { PENDING_APPROVAL_NOTICE, isPendingApproval, justificationRequired } from '@/lib/approvals';
import type { ApprovalMode } from '@/lib/types';
import { JustificationDialog } from '@/components/justification-dialog';

type Outcome = 'applied' | 'pending';
type Action = (justification?: string) => Promise<unknown>;

/**
 * Ciclo das mudanças sensíveis (SP2, 2.2): tenta sem justificativa → 409 JUSTIFICATION_REQUIRED abre o diálogo →
 * reenvia com o texto → aplicado (200/204) ou pendente (202, com aviso). Outros erros voltam para quem chamou,
 * que os mostra como sempre mostrou.
 */
export function useApprovalFlow() {
  const pending = useRef<{ action: Action; onDone: (outcome: Outcome) => void } | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; mode: ApprovalMode; message: string }>({
    open: false,
    mode: 'justification',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const finish = useCallback((result: unknown, onDone: (outcome: Outcome) => void) => {
    const outcome: Outcome = isPendingApproval(result) ? 'pending' : 'applied';
    if (outcome === 'pending') setNotice(PENDING_APPROVAL_NOTICE);
    onDone(outcome);
  }, []);

  const execute = useCallback(
    async (action: Action, onDone: (outcome: Outcome) => void) => {
      try {
        finish(await action(), onDone);
      } catch (e) {
        const required = justificationRequired(e);
        if (!required) throw e;
        pending.current = { action, onDone };
        setError(null);
        setDialog({ open: true, mode: required.mode, message: required.message });
      }
    },
    [finish],
  );

  const close = useCallback(() => {
    pending.current = null;
    setDialog((current) => ({ ...current, open: false }));
  }, []);

  const submit = useCallback(
    async (justification: string) => {
      const current = pending.current;
      if (!current) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await current.action(justification);
        close();
        finish(result, current.onDone);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Erro ao enviar a justificativa.');
      } finally {
        setSubmitting(false);
      }
    },
    [close, finish],
  );

  return {
    execute,
    notice,
    clearNotice: () => setNotice(null),
    dialog: (
      <JustificationDialog
        open={dialog.open}
        mode={dialog.mode}
        message={dialog.message}
        submitting={submitting}
        error={error}
        onSubmit={submit}
        onCancel={close}
      />
    ),
  };
}

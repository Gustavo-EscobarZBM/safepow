'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { POLICY_LABELS, describeRequest, modeDescription } from '@/lib/approvals';
import { formatDateTimeBR } from '@/lib/format';
import type {
  ApprovalPolicies,
  ApprovalPoliciesState,
  ApprovalPolicyKey,
  ChangeRequest,
  ChangeRequestStatus,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Tab = 'pending' | 'decided';

const POLICY_ORDER: ApprovalPolicyKey[] = ['price_change', 'retro_fix', 'loss_edit', 'archive_with_history'];

const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Recusado',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

/** O selo de pendentes do menu escuta este evento (nav.tsx). */
export const APPROVALS_CHANGED_EVENT = 'approvals:changed';

/**
 * Página Aprovações (SP2, 2.2.2): políticas da empresa (o painel não tem página de Configurações da empresa)
 * e a fila de pedidos — aprovar/recusar os de outros gerentes, cancelar os próprios.
 */
export function AprovacoesClient({ currentUserId }: { currentUserId: string }) {
  const [state, setState] = useState<ApprovalPoliciesState | null>(null);
  const [policies, setPolicies] = useState<ApprovalPolicies | null>(null);
  const [thresholdText, setThresholdText] = useState('');
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [policiesMessage, setPoliciesMessage] = useState<string | null>(null);
  const [policiesError, setPoliciesError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('pending');
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ApprovalPoliciesState>('approval-policies')
      .then((result) => {
        setState(result);
        setPolicies(result.policies);
        setThresholdText(String(result.policies.price_change.thresholdPercent));
      })
      .catch((e: unknown) => setPoliciesError(e instanceof ApiError ? e.message : 'Erro ao carregar as políticas.'));
  }, []);

  // Só a resposta da carga mais recente vale: trocar de aba rápido não pode mostrar a lista da outra aba.
  const loadSeq = useRef(0);
  const loadRequests = useCallback(async (which: Tab) => {
    const seq = ++loadSeq.current;
    setLoadingRequests(true);
    try {
      const result = await api.get<ChangeRequest[]>(`change-requests?status=${which}`);
      if (seq === loadSeq.current) setRequests(result);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setRequests([]); // sem a lista anterior (com botões de decisão) sob a aba errada
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar os pedidos.');
    } finally {
      if (seq === loadSeq.current) setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    setError(null);
    void loadRequests(tab);
  }, [tab, loadRequests]);

  function togglePolicy(key: ApprovalPolicyKey, enabled: boolean) {
    if (!policies) return;
    setPolicies({ ...policies, [key]: { ...policies[key], enabled } });
  }

  async function handleSavePolicies(e: FormEvent) {
    e.preventDefault();
    if (!policies) return;
    setSavingPolicies(true);
    setPoliciesMessage(null);
    setPoliciesError(null);
    try {
      const saved = await api.put<ApprovalPoliciesState>('approval-policies', {
        ...policies,
        price_change: { ...policies.price_change, thresholdPercent: Number(thresholdText) },
      });
      setState(saved);
      setPolicies(saved.policies);
      setThresholdText(String(saved.policies.price_change.thresholdPercent));
      setPoliciesMessage('Políticas salvas.');
    } catch (err) {
      setPoliciesError(err instanceof ApiError ? err.message : 'Erro ao salvar as políticas.');
    } finally {
      setSavingPolicies(false);
    }
  }

  async function decide(request: ChangeRequest, action: 'approve' | 'reject' | 'cancel') {
    setBusyId(request.id);
    setMessage(null);
    setError(null);
    try {
      const result =
        action === 'cancel'
          ? await api.post<ChangeRequest>(`change-requests/${request.id}/cancel`)
          : await api.post<ChangeRequest>(`change-requests/${request.id}/${action}`, {
              note: notes[request.id]?.trim() || undefined,
            });
      // Aprovar sobre um registro que mudou desde o pedido devolve 200 com o pedido expirado e a nota.
      if (result?.status === 'expired' && result.decisionNote) setMessage(result.decisionNote);
      window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT));
      await loadRequests(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao registrar a decisão.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Aprovações</h1>
        <p className="text-sm text-muted-foreground">
          Mudanças sensíveis pedem justificativa ou a aprovação de outro gerente, conforme as políticas abaixo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Políticas de aprovação</CardTitle>
          <CardDescription>{state ? modeDescription(state.activeManagers) : 'Carregando...'}</CardDescription>
        </CardHeader>
        {policies && (
          <form onSubmit={handleSavePolicies}>
            <CardContent className="flex flex-col gap-3">
              {POLICY_ORDER.map((key) => (
                <div key={key} className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox
                      checked={policies[key].enabled}
                      onCheckedChange={(checked) => togglePolicy(key, checked === true)}
                    />
                    {POLICY_LABELS[key]}
                  </label>
                  {key === 'price_change' && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="approval-threshold">Limite (%)</Label>
                      <Input
                        id="approval-threshold"
                        type="number"
                        min={1}
                        max={1000}
                        className="w-24"
                        value={thresholdText}
                        onChange={(e) => setThresholdText(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              ))}
              {policiesError && <p className="text-sm text-destructive">{policiesError}</p>}
              {policiesMessage && <p className="text-sm text-muted-foreground">{policiesMessage}</p>}
              <div>
                <Button type="submit" disabled={savingPolicies}>
                  {savingPolicies ? 'Salvando...' : 'Salvar políticas'}
                </Button>
              </div>
            </CardContent>
          </form>
        )}
        {!policies && policiesError && (
          <CardContent>
            <p className="text-sm text-destructive">{policiesError}</p>
          </CardContent>
        )}
      </Card>

      <div className="space-y-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList>
            <TabsTrigger value="pending">Pendentes</TabsTrigger>
            <TabsTrigger value="decided">Decididos</TabsTrigger>
          </TabsList>
        </Tabs>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {loadingRequests ? (
          <p className="text-sm text-muted-foreground">Carregando pedidos...</p>
        ) : requests.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">
            {tab === 'pending' ? 'Nenhum pedido aguardando aprovação.' : 'Nenhum pedido decidido ainda.'}
          </p>
        ) : (
          <ul aria-label="Pedidos" className="space-y-3">
            {requests.map((request) => {
              const mine = request.requestedByUserId === currentUserId;
              return (
                <li key={request.id} className="space-y-2 rounded-lg border p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{request.entityLabel ?? 'Registro'}</span>
                    <Badge variant="outline">{STATUS_LABELS[request.status] ?? request.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{POLICY_LABELS[request.policy] ?? request.policy}</p>
                  <ul className="space-y-0.5">
                    {describeRequest(request).map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Pedido por {request.requestedByName ?? 'usuário removido'} em {formatDateTimeBR(request.createdAt)}
                  </p>
                  <p className="text-xs">Justificativa: {request.justification}</p>
                  {request.status === 'pending' ? (
                    <>
                      <p className="text-xs text-muted-foreground">Vence em {formatDateTimeBR(request.expiresAt)}</p>
                      {mine ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === request.id}
                          onClick={() => decide(request, 'cancel')}
                        >
                          Cancelar pedido
                        </Button>
                      ) : (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                          <div className="flex-1 space-y-1">
                            <Label htmlFor={`note-${request.id}`}>Observação (opcional)</Label>
                            <Input
                              id={`note-${request.id}`}
                              maxLength={1000}
                              value={notes[request.id] ?? ''}
                              onChange={(e) => setNotes({ ...notes, [request.id]: e.target.value })}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" disabled={busyId === request.id} onClick={() => decide(request, 'approve')}>
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === request.id}
                              onClick={() => decide(request, 'reject')}
                            >
                              Recusar
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {STATUS_LABELS[request.status]}
                      {request.decidedByName ? ` por ${request.decidedByName}` : ''}
                      {request.decidedAt ? ` em ${formatDateTimeBR(request.decidedAt)}` : ''}
                      {request.decisionNote ? ` — ${request.decisionNote}` : ''}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { CompanySettings, Loss, TenantUser } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const NO_VERIFIER = 'none';

export default function ConferenciasPage() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [pending, setPending] = useState<Loss[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [verifierId, setVerifierId] = useState(NO_VERIFIER);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadAll() {
    api
      .get<CompanySettings>('companies/me/settings')
      .then((s) => {
        setSettings(s);
        setEnabled(s.lossVerificationEnabled);
        setVerifierId(s.lossVerifierId ?? NO_VERIFIER);
      })
      .catch((e: ApiError) => setError(e.message));
    api
      .get<TenantUser[]>('users')
      .then(setUsers)
      .catch((e: ApiError) => setError(e.message));
    api
      .get<Loss[]>('losses/pending-verification')
      .then(setPending)
      .catch((e: ApiError) => setError(e.message));
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const updated = await api.patch<CompanySettings>('companies/me/settings', {
        lossVerificationEnabled: enabled,
        lossVerifierId: verifierId === NO_VERIFIER ? null : verifierId,
      });
      setSettings(updated);
    } catch (e) {
      setSettingsError(e instanceof ApiError ? e.message : 'Erro ao salvar configurações.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleConfirm(lossId: string) {
    setConfirmingId(lossId);
    try {
      await api.patch(`losses/${lossId}/verify`);
      setPending((prev) => prev.filter((l) => l.id !== lossId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao confirmar a conferência.');
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-foreground">Conferências</h1>
        <p className="text-sm text-muted-foreground">
          Ative uma segunda validação sobre o que os funcionários descartam.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          <CardDescription>
            Quando ativada, toda perda registrada fica pendente até o conferente confirmar. Mudar esta
            configuração não afeta perdas já registradas.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSaveSettings}>
          <CardContent className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
              Ativar conferência de descarte
            </label>
            <div className="max-w-sm space-y-1.5">
              <Label>Conferente</Label>
              <Select value={verifierId} onValueChange={setVerifierId} disabled={!enabled}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VERIFIER}>Nenhum selecionado</SelectItem>
                  {users
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.role === 'manager' ? 'Gerente' : 'Funcionário'})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {settingsError && <p className="text-sm text-destructive">{settingsError}</p>}
            <Button type="submit" disabled={savingSettings} className="self-start">
              {savingSettings ? 'Salvando...' : 'Salvar configuração'}
            </Button>
          </CardContent>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pendências</CardTitle>
          <CardDescription>Perdas aguardando confirmação do conferente</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nenhuma pendência no momento.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Registrado por</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((loss) => (
                  <TableRow key={loss.id}>
                    <TableCell>{loss.product?.name ?? '—'}</TableCell>
                    <TableCell>{loss.quantity}</TableCell>
                    <TableCell>{loss.reportedBy?.name ?? '—'}</TableCell>
                    <TableCell>{new Date(loss.occurredAt).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => handleConfirm(loss.id)}
                        disabled={confirmingId === loss.id}
                      >
                        {confirmingId === loss.id ? 'Confirmando...' : 'Confirmar'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {settings && (
        <p className="text-xs text-muted-foreground">
          Status atual:{' '}
          <Badge variant={settings.lossVerificationEnabled ? 'default' : 'secondary'}>
            {settings.lossVerificationEnabled ? 'Ativada' : 'Desativada'}
          </Badge>
        </p>
      )}
    </div>
  );
}

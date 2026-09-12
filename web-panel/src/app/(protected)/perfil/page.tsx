'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { TenantUser } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const ROLE_LABELS: Record<TenantUser['role'], string> = {
  master_admin: 'Administrador Master',
  manager: 'Gerente',
  employee: 'Funcionário',
};

export default function ProfilePage() {
  const [me, setMe] = useState<TenantUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataSuccess, setDataSuccess] = useState(false);
  const [savingData, setSavingData] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    api
      .get<TenantUser>('users/me')
      .then((data) => {
        setMe(data);
        setName(data.name);
        setEmail(data.email);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Erro ao carregar seu perfil.'))
      .finally(() => setLoading(false));
  }, []);

  // Funcionário só troca a própria senha — nome/e-mail continuam exclusivos
  // do gerente, pra evitar confusão de identidade/login no time (mesma regra
  // aplicada no backend em UsersService.updateMe).
  const canEditData = me?.role !== 'employee';

  async function handleDataSubmit(e: FormEvent) {
    e.preventDefault();
    setSavingData(true);
    setDataError(null);
    setDataSuccess(false);
    try {
      const updated = await api.patch<TenantUser>('users/me', { name, email });
      setMe(updated);
      setDataSuccess(true);
    } catch (e) {
      setDataError(e instanceof ApiError ? e.message : 'Erro ao salvar seus dados.');
    } finally {
      setSavingData(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação não bate com a nova senha.');
      return;
    }

    setSavingPassword(true);
    try {
      await api.patch('users/me', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess(true);
    } catch (e) {
      setPasswordError(e instanceof ApiError ? e.message : 'Erro ao trocar a senha.');
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (loadError || !me) {
    return <p className="text-sm text-destructive">{loadError || 'Não foi possível carregar seu perfil.'}</p>;
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-2xl text-foreground">Meu perfil</h1>
        <p className="text-sm text-muted-foreground">Seus dados de acesso ao painel.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Dados pessoais</CardTitle>
          <CardDescription>
            {canEditData
              ? 'Nome e e-mail usados para acessar o painel.'
              : 'Nome, e-mail e papel só podem ser alterados pelo seu gerente.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEditData ? (
            <form onSubmit={handleDataSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Papel</Label>
                <Input value={ROLE_LABELS[me.role]} disabled />
              </div>

              {dataError && <p className="text-sm text-destructive sm:col-span-2">{dataError}</p>}
              {dataSuccess && <p className="text-sm text-success sm:col-span-2">Dados atualizados.</p>}

              <div className="sm:col-span-2">
                <Button type="submit" disabled={savingData}>
                  {savingData ? 'Salvando...' : 'Salvar dados'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <p className="text-sm text-foreground">{me.name}</p>
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <p className="text-sm text-foreground">{me.email}</p>
              </div>
              <div className="space-y-1.5">
                <Label>Papel</Label>
                <p className="text-sm text-foreground">{ROLE_LABELS[me.role]}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Alterar senha</CardTitle>
          <CardDescription>Informe a senha atual para definir uma nova.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Senha atual</Label>
              <Input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nova senha</Label>
              <Input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar nova senha</Label>
              <Input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {passwordError && <p className="text-sm text-destructive sm:col-span-2">{passwordError}</p>}
            {passwordSuccess && <p className="text-sm text-success sm:col-span-2">Senha alterada.</p>}

            <div className="sm:col-span-2">
              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? 'Salvando...' : 'Alterar senha'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

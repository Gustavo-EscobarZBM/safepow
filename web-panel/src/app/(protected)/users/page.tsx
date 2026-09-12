'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import type { TenantUser, UserRole } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const emptyForm = { name: '', email: '', password: '', role: 'employee' as UserRole };

export default function UsersPage() {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [userToEdit, setUserToEdit] = useState<TenantUser | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'employee' as UserRole, password: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [userToDelete, setUserToDelete] = useState<TenantUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await api.get<TenantUser[]>('users');
      setUsers(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar usuários.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('users', form);
      setForm(emptyForm);
      await loadUsers();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Erro ao convidar usuário.');
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(user: TenantUser) {
    setUserToEdit(user);
    setEditForm({ name: user.name, email: user.email, role: user.role as UserRole, password: '' });
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userToEdit) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await api.patch(`users/${userToEdit.id}`, {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        password: editForm.password || undefined,
      });
      setUserToEdit(null);
      await loadUsers();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Erro ao salvar usuário.');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!userToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`users/${userToDelete.id}`);
      setUserToDelete(null);
      await loadUsers();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Erro ao excluir usuário.');
    } finally {
      setDeleting(false);
    }
  }

  async function toggleActive(user: TenantUser) {
    setUpdatingId(user.id);
    try {
      const action = user.isActive ? 'deactivate' : 'reactivate';
      await api.patch(`users/${user.id}/${action}`);
      await loadUsers();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao atualizar usuário.');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-foreground">Usuários da empresa</h1>
        <p className="text-sm text-muted-foreground">
          Convide funcionários (acesso só ao app) ou outros gerentes (acesso ao painel web).
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Senha provisória</Label>
              <Input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as UserRole })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Funcionário (app)</SelectItem>
                  <SelectItem value="manager">Gerente (painel web)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formError && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-4">{formError}</p>}

            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Convidando...' : 'Convidar usuário'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  Nenhum usuário cadastrado ainda.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell className="capitalize">
                    {user.role === 'employee' ? 'Funcionário' : 'Gerente'}
                  </TableCell>
                  <TableCell>
                    <Badge className={user.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}>
                      {user.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleActive(user)}
                        disabled={updatingId === user.id}
                      >
                        {updatingId === user.id ? 'Atualizando...' : user.isActive ? 'Desativar' : 'Reativar'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${user.name}`}
                        title="Editar"
                        onClick={() => openEdit(user)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${user.name}`}
                        title="Excluir"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          setUserToDelete(user);
                          setDeleteError(null);
                        }}
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
      </Card>

      <Dialog open={!!userToEdit} onOpenChange={(open) => !open && setUserToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
            <DialogDescription>Altere os dados de {userToEdit?.name}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome</Label>
                <Input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  required
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Papel</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(v) => setEditForm({ ...editForm, role: v as UserRole })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Funcionário (app)</SelectItem>
                    <SelectItem value="manager">Gerente (painel web)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Nova senha (opcional)</Label>
                <Input
                  type="password"
                  minLength={6}
                  placeholder="Deixe em branco para manter"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                />
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUserToEdit(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{userToDelete?.name}</strong>? Essa ação é permanente
              e não pode ser desfeita. Se ele já registrou perdas, use &quot;Desativar&quot; em vez disso.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserToDelete(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirmed} disabled={deleting}>
              {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

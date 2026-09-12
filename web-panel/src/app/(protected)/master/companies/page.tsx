'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Pencil, RefreshCw, Search, Trash2, Unlock } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import type { Company, CompanyStatus } from '@/lib/types';
import { CompanyStatusBadge } from '@/components/company-status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const emptyForm = {
  name: '',
  cnpj: '',
  managerName: '',
  managerEmail: '',
  managerPassword: '',
};

const STATUS_FILTERS: { value: CompanyStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativo' },
  { value: 'past_due', label: 'Vencido' },
  { value: 'blocked', label: 'Bloqueado' },
];

function toDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function defaultDueDate() {
  return toDateInputValue(addDays(new Date(), 30));
}

// currentPeriodEnd é uma data "de calendário" (sem hora) guardada como
// meia-noite UTC. Formatar com o fuso local do navegador pode exibir o dia
// anterior (ex: em UTC-3, meia-noite UTC vira 21h do dia anterior) — por
// isso a formatação de exibição também fixa timeZone: 'UTC'.
function formatDueDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function MasterCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, firstDueDate: defaultDueDate() });
  const [actionId, setActionId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | 'all'>('all');
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [companyToEdit, setCompanyToEdit] = useState<Company | null>(null);
  const [editForm, setEditForm] = useState({ name: '', cnpj: '', planTier: '', currentPeriodEnd: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  async function loadCompanies() {
    setLoading(true);
    try {
      const data = await api.get<Company[]>('master/companies');
      setCompanies(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar empresas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  const filteredCompanies = useMemo(() => {
    const term = search.trim().toLowerCase();
    return companies.filter((company) => {
      const matchesSearch = !term || company.name.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || company.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [companies, search, statusFilter]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('master/companies', {
        name: form.name,
        cnpj: form.cnpj || undefined,
        managerName: form.managerName,
        managerEmail: form.managerEmail,
        managerPassword: form.managerPassword,
        firstDueDate: form.firstDueDate ? new Date(form.firstDueDate).toISOString() : undefined,
      });
      setForm({ ...emptyForm, firstDueDate: defaultDueDate() });
      await loadCompanies();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Erro ao cadastrar empresa.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRenew(company: Company) {
    setActionId(company.id);
    try {
      await api.patch(`master/companies/${company.id}/renew`);
      await loadCompanies();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao renovar assinatura.');
    } finally {
      setActionId(null);
    }
  }

  async function handleUnlock(company: Company) {
    setActionId(company.id);
    try {
      await api.patch(`master/companies/${company.id}/unlock`);
      await loadCompanies();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao desbloquear empresa.');
    } finally {
      setActionId(null);
    }
  }

  function openEdit(company: Company) {
    setCompanyToEdit(company);
    setEditForm({
      name: company.name,
      cnpj: company.cnpj || '',
      planTier: company.planTier,
      // currentPeriodEnd é meia-noite UTC (mesma nuance de formatDueDate acima) —
      // usar toISOString().slice(0,10) em vez de toDateInputValue (que lê em fuso
      // local) evita que o campo de data mostre um dia a menos em fusos UTC-.
      currentPeriodEnd: company.currentPeriodEnd
        ? new Date(company.currentPeriodEnd).toISOString().slice(0, 10)
        : '',
    });
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!companyToEdit) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await api.patch(`master/companies/${companyToEdit.id}`, {
        name: editForm.name,
        cnpj: editForm.cnpj || undefined,
        planTier: editForm.planTier || undefined,
        currentPeriodEnd: editForm.currentPeriodEnd
          ? new Date(editForm.currentPeriodEnd).toISOString()
          : undefined,
      });
      setCompanyToEdit(null);
      await loadCompanies();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Erro ao salvar empresa.');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!companyToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`master/companies/${companyToDelete.id}`);
      setCompanyToDelete(null);
      await loadCompanies();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao excluir empresa.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-foreground">
          Painel Master — Empresas clientes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastro de novas empresas e controle de mensalidades por vencimento (Seção 6 do documento).
        </p>
      </div>

      <Card size="lg">
        <CardHeader>
          <CardTitle className="text-lg">Cadastrar nova empresa</CardTitle>
          <CardDescription>Preencha os dados abaixo para liberar o acesso da empresa.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Nome da empresa</Label>
                <Input
                  required
                  placeholder="Razão social ou fantasia"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>CNPJ (opcional)</Label>
                <Input
                  placeholder="00.000.000/0000-00"
                  value={form.cnpj}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vencimento inicial</Label>
                <div className="relative">
                  <Input
                    type="date"
                    required
                    className="pr-9"
                    value={form.firstDueDate}
                    onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })}
                  />
                  <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Nome do gerente</Label>
                <Input
                  required
                  placeholder="Responsável pela conta"
                  value={form.managerName}
                  onChange={(e) => setForm({ ...form, managerName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail do gerente</Label>
                <Input
                  type="email"
                  required
                  placeholder="gerente@empresa.com"
                  value={form.managerEmail}
                  onChange={(e) => setForm({ ...form, managerEmail: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Senha provisória</Label>
                <Input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Defina uma senha inicial"
                  value={form.managerPassword}
                  onChange={(e) => setForm({ ...form, managerPassword: e.target.value })}
                />
              </div>

              {formError && (
                <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{formError}</p>
              )}

              <div className="flex justify-end sm:col-span-2 lg:col-span-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Cadastrando...' : 'Cadastrar empresa'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Nome da empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as CompanyStatus | 'all')}>
          <TabsList>
            {STATUS_FILTERS.map((filter) => (
              <TabsTrigger key={filter.value} value={filter.value}>
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Cadastrada em</TableHead>
                <TableHead className="pr-6 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : filteredCompanies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    {companies.length === 0
                      ? 'Nenhuma empresa cadastrada ainda.'
                      : 'Nenhuma empresa encontrada para esse filtro.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCompanies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="pl-6 font-medium">{company.name}</TableCell>
                    <TableCell>
                      <CompanyStatusBadge status={company.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDueDate(company.currentPeriodEnd)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(company.createdAt).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="pr-6">
                      <div className="flex justify-end gap-1">
                        {(company.status === 'past_due' || company.status === 'blocked') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Renovar ${company.name}`}
                            title="Renovar assinatura"
                            onClick={() => handleRenew(company)}
                            disabled={actionId === company.id}
                          >
                            <RefreshCw className="size-4" />
                          </Button>
                        )}
                        {company.status === 'blocked' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Desbloquear ${company.name}`}
                            title="Desbloquear"
                            onClick={() => handleUnlock(company)}
                            disabled={actionId === company.id}
                          >
                            <Unlock className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${company.name}`}
                          title="Editar"
                          onClick={() => openEdit(company)}
                          disabled={actionId === company.id}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir ${company.name}`}
                          title="Excluir"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setCompanyToDelete(company)}
                          disabled={actionId === company.id}
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
        </CardContent>
      </Card>

      <Dialog open={!!companyToEdit} onOpenChange={(open) => !open && setCompanyToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar empresa</DialogTitle>
            <DialogDescription>Altere os dados cadastrais de {companyToEdit?.name}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome da empresa</Label>
                <Input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>CNPJ (opcional)</Label>
                <Input
                  value={editForm.cnpj}
                  onChange={(e) => setEditForm({ ...editForm, cnpj: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Plano</Label>
                <Input
                  value={editForm.planTier}
                  onChange={(e) => setEditForm({ ...editForm, planTier: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Vencimento</Label>
                <div className="relative">
                  <Input
                    type="date"
                    className="pr-9"
                    value={editForm.currentPeriodEnd}
                    onChange={(e) => setEditForm({ ...editForm, currentPeriodEnd: e.target.value })}
                  />
                  <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCompanyToEdit(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!companyToDelete} onOpenChange={(open) => !open && setCompanyToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir empresa</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{companyToDelete?.name}</strong>? Essa ação é
              permanente e apaga também todos os usuários, produtos e perdas registradas por essa
              empresa. Não é possível desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyToDelete(null)} disabled={deleting}>
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

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SessionUser } from '@/lib/types';

function redirectPathForRole(role: SessionUser['role']) {
  if (role === 'master_admin') return '/master/companies';
  if (role === 'employee') return '/losses';
  return '/dashboard';
}

// Botões de acesso rápido — só para acelerar os testes durante o
// desenvolvimento. Pedido explícito do usuário para remover depois que o
// projeto estiver pronto; por segurança já ficam ocultos fora de dev mesmo
// que ninguém lembre de tirar o código a tempo.
const QUICK_LOGIN_ENABLED = process.env.NODE_ENV !== 'production';
const QUICK_LOGINS = [
  { role: 'master_admin' as const, label: 'Administrador Master', email: 'master@seusistema.com.br', password: 'troque-esta-senha' },
  { role: 'manager' as const, label: 'Gerente', email: 'gerente.demo@safepow.com', password: 'demo1234' },
  { role: 'employee' as const, label: 'Funcionário', email: 'funcionario.demo@safepow.com', password: 'demo1234' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickRole, setQuickRole] = useState<string | null>(null);

  // "Vencido": login é permitido, mas o acesso ao painel fica represado até o
  // usuário marcar ciência no modal — não pode ser fechado clicando fora.
  const [pendingUser, setPendingUser] = useState<SessionUser | null>(null);
  const [companyDueDate, setCompanyDueDate] = useState<string | null>(null);
  const [aware, setAware] = useState(false);

  function enterPanel(role: SessionUser['role']) {
    router.push(redirectPathForRole(role));
    router.refresh();
  }

  async function performLogin(loginEmail: string, loginPassword: string) {
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Não foi possível entrar.');
        return;
      }

      if (data.companyStatus === 'past_due') {
        setCompanyDueDate(data.companyDueDate ?? null);
        setAware(false);
        setPendingUser(data.user);
        return;
      }

      enterPanel(data.user.role);
    } catch {
      setError('Erro de conexão com o servidor.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await performLogin(email, password);
    setLoading(false);
  }

  async function handleQuickLogin(login: (typeof QUICK_LOGINS)[number]) {
    setQuickRole(login.role);
    await performLogin(login.email, login.password);
    setQuickRole(null);
  }

  function handleContinueToPanel() {
    if (!pendingUser) return;
    enterPanel(pendingUser.role);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <ThemeToggle iconOnly className="fixed top-4 right-4" />
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center pb-2 text-center">
          <Logo variant="light" className="mb-2 flex-col text-center [&>div]:items-center" />
          <p className="pt-3 text-sm text-muted-foreground">Painel de gestão</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>

          {QUICK_LOGIN_ENABLED && (
            <div className="mt-6 space-y-2 rounded-lg border border-dashed border-warning/40 bg-warning/10 p-3">
              <p className="text-center text-[0.7rem] font-semibold uppercase tracking-wide text-warning-foreground">
                Acesso rápido (somente testes)
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {QUICK_LOGINS.map((login) => (
                  <Button
                    key={login.role}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || quickRole !== null}
                    onClick={() => handleQuickLogin(login)}
                  >
                    {quickRole === login.role ? 'Entrando...' : `Entrar como ${login.label}`}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!pendingUser} onOpenChange={() => undefined}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Mensalidade em atraso</DialogTitle>
            <DialogDescription>
              A mensalidade desta empresa está atrasada
              {companyDueDate &&
                ` desde ${new Date(companyDueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`}
              . Regularize o pagamento o quanto antes — o acesso ao painel será bloqueado
              automaticamente se o atraso ultrapassar 3 dias.
            </DialogDescription>
          </DialogHeader>

          <label className="flex items-start gap-2 text-sm text-foreground">
            <Checkbox checked={aware} onCheckedChange={(checked) => setAware(checked === true)} className="mt-0.5" />
            Estou ciente de que o acesso será bloqueado se não for regularizado.
          </label>

          <DialogFooter>
            <Button onClick={handleContinueToPanel} disabled={!aware} className="w-full sm:w-auto">
              Continuar e acessar o painel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

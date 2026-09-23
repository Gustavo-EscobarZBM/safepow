'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { clearRememberedEmail, saveRememberedEmail } from '@/lib/remembered-email';
import type { SessionUser } from '@/lib/types';
import { BrandPanel } from './brand-panel';
import { LoginForm, type LoginValues } from './login-form';

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

type LoginOutcome = 'entered' | 'pending-acknowledgement' | 'failed';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickRole, setQuickRole] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'success'>('idle');

  // "Vencido": login é permitido, mas o acesso ao painel fica represado até o
  // usuário marcar ciência no modal — não pode ser fechado clicando fora.
  const [pendingUser, setPendingUser] = useState<SessionUser | null>(null);
  const [companyDueDate, setCompanyDueDate] = useState<string | null>(null);
  const [aware, setAware] = useState(false);

  function enterPanel(role: SessionUser['role']) {
    setStatus('success');
    router.push(redirectPathForRole(role));
    router.refresh();
  }

  async function performLogin(loginEmail: string, loginPassword: string): Promise<LoginOutcome> {
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
        return 'failed';
      }

      if (data.companyStatus === 'past_due') {
        setCompanyDueDate(data.companyDueDate ?? null);
        setAware(false);
        setPendingUser(data.user);
        return 'pending-acknowledgement';
      }

      enterPanel(data.user.role);
      return 'entered';
    } catch {
      setError('Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.');
      return 'failed';
    }
  }

  async function handleSubmit({ email, password, rememberEmail }: LoginValues) {
    setLoading(true);
    const outcome = await performLogin(email, password);
    if (outcome !== 'failed') {
      if (rememberEmail) saveRememberedEmail(email);
      else clearRememberedEmail();
    }
    // Ao entrar no painel o botão segue travado até a navegação terminar.
    if (outcome !== 'entered') setLoading(false);
  }

  async function handleQuickLogin(role: string) {
    const login = QUICK_LOGINS.find((item) => item.role === role);
    if (!login) return;
    setQuickRole(role);
    const outcome = await performLogin(login.email, login.password);
    if (outcome !== 'entered') setQuickRole(null);
  }

  function handleContinueToPanel() {
    if (!pendingUser) return;
    enterPanel(pendingUser.role);
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel status={status} />

      <main className="relative flex">
        <ThemeToggle iconOnly className="absolute right-4 top-4" />
        <LoginForm
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
          quickLogins={QUICK_LOGIN_ENABLED ? QUICK_LOGINS.map(({ role, label }) => ({ role, label })) : undefined}
          onQuickLogin={handleQuickLogin}
          quickLoginRole={quickRole}
        />
      </main>

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

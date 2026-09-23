'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle, Mail } from 'lucide-react';
import { Logo } from '@/components/logo';
import { PasswordInput } from '@/components/password-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { greetingForHour } from '@/lib/greeting';
import { readRememberedEmail } from '@/lib/remembered-email';

export interface LoginValues {
  email: string;
  password: string;
  rememberEmail: boolean;
}

export interface LoginFormProps {
  onSubmit: (values: LoginValues) => void;
  loading: boolean;
  error: string | null;
  quickLogins?: { role: string; label: string }[];
  onQuickLogin?: (role: string) => void;
  quickLoginRole?: string | null;
}

export function LoginForm({ onSubmit, loading, error, quickLogins, onQuickLogin, quickLoginRole = null }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(false);
  // Calculada após a montagem: a hora do servidor e a do navegador diferem, e isso quebraria a hidratação.
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));

    const remembered = readRememberedEmail();
    if (remembered) {
      setEmail(remembered);
      setRememberEmail(true);
    }
    document.getElementById(remembered ? 'password' : 'email')?.focus();
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ email, password, rememberEmail });
  }

  const invalid = error ? true : undefined;
  const busy = loading || quickLoginRole !== null;

  return (
    <section className="flex w-full flex-col justify-center px-6 py-16 sm:px-12">
      <div className="mx-auto w-full max-w-sm">
        <Logo className="mb-10 w-44 text-foreground lg:hidden" />

        <p className="min-h-5 text-sm text-muted-foreground">{greeting}</p>
        <h1 className="font-display text-3xl text-foreground">Entrar no painel</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use o e-mail e a senha da sua empresa.</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="nome@empresa.com.br"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={invalid}
                className="h-10 border-foreground/70 pl-9 focus-visible:ring-2 focus-visible:ring-ring/60 dark:border-foreground/25"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <PasswordInput
              id="password"
              required
              minLength={6}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={invalid}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={rememberEmail} onCheckedChange={(checked) => setRememberEmail(checked === true)} />
            Lembrar meu e-mail neste computador
          </label>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          <Button type="submit" disabled={busy} className="h-10 w-full text-sm focus-visible:ring-2">
            {loading ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Entrando…
              </>
            ) : (
              'Entrar'
            )}
          </Button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          Esqueceu a senha? Peça ao gerente da sua empresa para redefinir.
        </p>

        {quickLogins && quickLogins.length > 0 && (
          <div className="mt-8 rounded-lg border border-dashed border-warning/50 bg-warning/10 p-3">
            <p className="mb-2 text-xs text-warning-foreground">Somente em desenvolvimento</p>
            <div className="flex flex-wrap gap-1.5">
              {quickLogins.map((quick) => (
                <Button
                  key={quick.role}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Entrar como ${quick.label}`}
                  disabled={busy}
                  onClick={() => onQuickLogin?.(quick.role)}
                >
                  {quickLoginRole === quick.role ? 'Entrando…' : quick.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './login-form';

function setup(props: Partial<React.ComponentProps<typeof LoginForm>> = {}) {
  const onSubmit = vi.fn();
  render(<LoginForm onSubmit={onSubmit} loading={false} error={null} {...props} />);
  return { onSubmit };
}

async function fillCredentials(email = 'ana@empresa.com.br', password = 'segredo1') {
  await userEvent.type(screen.getByLabelText('E-mail'), email);
  await userEvent.type(screen.getByLabelText('Senha'), password);
}

describe('LoginForm', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('greets according to the time of day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 19, 15, 0, 0));
    setup();

    expect(await screen.findByText('Boa tarde')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
  });

  it('submits the typed credentials without remembering the e-mail by default', async () => {
    const { onSubmit } = setup();

    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ana@empresa.com.br',
      password: 'segredo1',
      rememberEmail: false,
    });
  });

  it('lets the user ask to remember the e-mail on this computer', async () => {
    const { onSubmit } = setup();

    await fillCredentials();
    await userEvent.click(screen.getByRole('checkbox', { name: /lembrar meu e-mail neste computador/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ rememberEmail: true }));
  });

  it('pre-fills a remembered e-mail and keeps the option checked', async () => {
    localStorage.setItem('remembered-email', 'ana@empresa.com.br');
    setup();

    expect(await screen.findByDisplayValue('ana@empresa.com.br')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /lembrar meu e-mail neste computador/i })).toBeChecked();
  });

  it('shows a sign-in error as an alert and marks the fields as invalid', () => {
    setup({ error: 'E-mail ou senha inválidos.' });

    expect(screen.getByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true');
  });

  it('blocks a second submit while signing in', () => {
    setup({ loading: true });

    expect(screen.getByRole('button', { name: /entrando/i })).toBeDisabled();
  });

  it('tells the user how to recover access instead of promising a reset flow that does not exist', () => {
    setup();

    expect(screen.getByText(/peça ao gerente da sua empresa para redefinir/i)).toBeInTheDocument();
  });

  it('offers the development-only quick logins when provided', async () => {
    const onQuickLogin = vi.fn();
    setup({
      quickLogins: [
        { role: 'manager', label: 'Gerente' },
        { role: 'employee', label: 'Funcionário' },
      ],
      onQuickLogin,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Entrar como Gerente' }));

    expect(onQuickLogin).toHaveBeenCalledWith('manager');
    expect(screen.getByText(/somente em desenvolvimento/i)).toBeInTheDocument();
  });

  it('does not render the quick logins block when none are provided', () => {
    setup();

    expect(screen.queryByText(/somente em desenvolvimento/i)).not.toBeInTheDocument();
  });
});

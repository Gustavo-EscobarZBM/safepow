import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));

function mockLogin(payload: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => payload }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function signIn(email = 'ana@empresa.com.br', password = 'segredo1') {
  await userEvent.type(screen.getByLabelText('E-mail'), email);
  await userEvent.type(screen.getByLabelText('Senha'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sends each role to its own home after a successful sign-in', async () => {
    mockLogin({ user: { role: 'manager' }, companyStatus: 'active' });
    render(<LoginPage />);

    await signIn();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/dashboard'));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('sends employees to the losses screen and the master admin to the companies panel', async () => {
    mockLogin({ user: { role: 'employee' }, companyStatus: 'active' });
    const first = render(<LoginPage />);
    await signIn();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/losses'));
    first.unmount();

    router.push.mockClear();
    mockLogin({ user: { role: 'master_admin' }, companyStatus: 'active' });
    render(<LoginPage />);
    await signIn();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/master/companies'));
  });

  it('shows the backend message when the credentials are rejected', async () => {
    mockLogin({ message: 'E-mail ou senha inválidos.' }, false);
    render(<LoginPage />);

    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('explains what to do when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network'))));
    render(<LoginPage />);

    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível conectar ao servidor/i);
  });

  it('holds the panel access behind the overdue-payment acknowledgement', async () => {
    mockLogin({ user: { role: 'manager' }, companyStatus: 'past_due', companyDueDate: '2026-09-10T00:00:00.000Z' });
    render(<LoginPage />);

    await signIn();

    expect(await screen.findByText('Mensalidade em atraso')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    const proceed = screen.getByRole('button', { name: /continuar e acessar o painel/i });
    expect(proceed).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: /estou ciente/i }));
    await userEvent.click(proceed);

    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  it('remembers the e-mail only when the user asked for it', async () => {
    mockLogin({ user: { role: 'manager' }, companyStatus: 'active' });
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@empresa.com.br');
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo1');
    await userEvent.click(screen.getByRole('checkbox', { name: /lembrar meu e-mail/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(localStorage.getItem('remembered-email')).toBe('ana@empresa.com.br'));
  });

  it('forgets a previously remembered e-mail when the option is turned off', async () => {
    localStorage.setItem('remembered-email', 'ana@empresa.com.br');
    mockLogin({ user: { role: 'manager' }, companyStatus: 'active' });
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText('Senha'), 'segredo1');
    await userEvent.click(screen.getByRole('checkbox', { name: /lembrar meu e-mail/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(localStorage.getItem('remembered-email')).toBeNull();
  });

  it('confirms the sign-in on the barcode animation while the panel loads', async () => {
    mockLogin({ user: { role: 'manager' }, companyStatus: 'active' });
    render(<LoginPage />);

    await signIn();

    await waitFor(() =>
      expect(screen.getByRole('img', { name: /código de barras/i })).toHaveAttribute('data-state', 'success'),
    );
  });

  it('signs in with the development quick login credentials', async () => {
    const fetchMock = mockLogin({ user: { role: 'manager' }, companyStatus: 'active' });
    render(<LoginPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Entrar como Gerente' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/dashboard'));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.email).toBe('gerente.demo@safepow.com');
  });
});

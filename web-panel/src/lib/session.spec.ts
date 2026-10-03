import { beforeEach, describe, expect, it, vi } from 'vitest';
const { set } = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => ({ set }) }));
import { setSessionCookies } from './session';

describe('cookies da instalacao local', () => {
  beforeEach(() => { vi.unstubAllEnvs(); set.mockClear(); });
  it('mantem HTTPS como padrao em producao', () => {
    vi.stubEnv('NODE_ENV', 'production');
    setSessionCookies('token', { id: '1', name: 'Master', role: 'master_admin', companyId: null });
    expect(set.mock.calls[0][2]).toMatchObject({ httpOnly: true, secure: true });
  });
  it('permite HTTP somente quando configurado explicitamente para o ambiente local', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    setSessionCookies('token', { id: '1', name: 'Master', role: 'master_admin', companyId: null });
    expect(set.mock.calls[0][2]).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax' });
    expect(set.mock.calls[1][2].secure).toBe(false);
  });
});

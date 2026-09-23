// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { setSessionCookies } from '@/lib/session';

vi.mock('@/lib/session', () => ({ setSessionCookies: vi.fn() }));

const baseUser = { id: 'u1', name: 'Fulano', role: 'employee', companyId: 'c1' };

function loginRequest() {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'fulano@example.com', password: 'segredo' }),
  });
}

function mockBackendLogin(extra: Record<string, unknown>) {
  const payload = { accessToken: 'tok', user: baseUser, companyStatus: 'active', companyDueDate: null, ...extra };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the loss-verifier flag in the session cookie and in the response', async () => {
    mockBackendLogin({ lossVerificationEnabled: true, isLossVerifier: true });

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(setSessionCookies).toHaveBeenCalledWith('tok', { ...baseUser, isLossVerifier: true });
    expect(body.user).toEqual({ ...baseUser, isLossVerifier: true });
  });

  it('records an explicit false when the backend does not flag the user as verifier', async () => {
    mockBackendLogin({});

    await POST(loginRequest());

    expect(setSessionCookies).toHaveBeenCalledWith('tok', { ...baseUser, isLossVerifier: false });
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from './middleware';

describe('middleware — which requests it guards', () => {
  // A logo e os ícones precisam carregar na tela de login, antes de existir sessão.
  const guarded = new RegExp(`^${config.matcher[0]}$`);

  it('does not put the brand assets and app icons behind the login', () => {
    for (const path of ['/icon.svg', '/apple-icon.png', '/favicon.ico', '/brand/logo-full.svg', '/brand/logo-mark-white.svg']) {
      expect(guarded.test(path), path).toBe(false);
    }
  });

  it('still guards the application pages', () => {
    for (const path of ['/dashboard', '/losses', '/conferencias', '/users']) {
      expect(guarded.test(path), path).toBe(true);
    }
  });
});

function requestAs(pathname: string, user: object) {
  const cookie = [
    'inv_saas_session=token',
    `inv_saas_session_user=${encodeURIComponent(JSON.stringify(user))}`,
  ].join('; ');
  return new NextRequest(`http://localhost${pathname}`, { headers: { cookie } });
}

const employee = { id: 'e1', name: 'Emp', role: 'employee', companyId: 'c1' };
const verifier = { ...employee, isLossVerifier: true };
const manager = { id: 'm1', name: 'Ger', role: 'manager', companyId: 'c1' };

function passesThrough(response: Response) {
  return response.headers.get('x-middleware-next') === '1';
}

function redirectPath(response: Response) {
  const location = response.headers.get('location');
  return location ? new URL(location).pathname : null;
}

describe('middleware — role based navigation guard', () => {
  it('keeps a regular employee on the losses screen', () => {
    expect(passesThrough(middleware(requestAs('/losses', employee)))).toBe(true);
    expect(redirectPath(middleware(requestAs('/conferencias', employee)))).toBe('/losses');
  });

  it('lets the employee designated as verifier open the confirmations screen', () => {
    expect(passesThrough(middleware(requestAs('/conferencias', verifier)))).toBe(true);
  });

  it('still keeps the verifier away from every other manager-only screen', () => {
    expect(redirectPath(middleware(requestAs('/dashboard', verifier)))).toBe('/losses');
    expect(redirectPath(middleware(requestAs('/users', verifier)))).toBe('/losses');
  });

  it('does not restrict managers', () => {
    expect(passesThrough(middleware(requestAs('/conferencias', manager)))).toBe(true);
  });
});

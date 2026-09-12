import { cookies } from 'next/headers';
import type { SessionUser } from './types';

const TOKEN_COOKIE = process.env.SESSION_COOKIE_NAME || 'inv_saas_session';
const USER_COOKIE = `${TOKEN_COOKIE}_user`;

/**
 * O token JWT fica em um cookie httpOnly (inacessível ao JavaScript do
 * navegador — mitiga roubo de token via XSS). Um segundo cookie, NÃO
 * httpOnly, guarda só os dados não sensíveis do usuário (nome/papel) para a
 * interface decidir o que mostrar — a autorização de verdade é sempre
 * recalculada pelo backend a cada requisição, então esse cookie é só UX.
 */
export function setSessionCookies(accessToken: string, user: SessionUser) {
  const store = cookies();
  const maxAge = 60 * 60 * 8; // 8h — deve bater com JWT_EXPIRES_IN do backend

  store.set(TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  store.set(USER_COOKIE, JSON.stringify(user), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookies() {
  const store = cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(USER_COOKIE);
}

export function getAccessToken(): string | null {
  return cookies().get(TOKEN_COOKIE)?.value ?? null;
}

export function getSessionUser(): SessionUser | null {
  const raw = cookies().get(USER_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export { TOKEN_COOKIE, USER_COOKIE };

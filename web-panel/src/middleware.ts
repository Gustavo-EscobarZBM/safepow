import { NextRequest, NextResponse } from 'next/server';

const TOKEN_COOKIE = process.env.SESSION_COOKIE_NAME || 'inv_saas_session';
const USER_COOKIE = `${TOKEN_COOKIE}_user`;
const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith('/api/auth');
  if (isPublic) return NextResponse.next();

  const hasSession = request.cookies.has(TOKEN_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Funcionário só tem acesso à tela de registro de perdas e ao próprio perfil
  // — qualquer outra rota do painel (dashboard, produtos, usuários, painel
  // master...) volta para /losses. A checagem de verdade continua no backend
  // a cada request; isso aqui é só para não deixar a navegação do painel
  // chegar lá.
  const EMPLOYEE_ALLOWED_PATHS = ['/losses', '/perfil'];
  const userCookie = request.cookies.get(USER_COOKIE)?.value;
  if (userCookie) {
    try {
      const user = JSON.parse(userCookie) as { role?: string };
      if (user.role === 'employee' && !EMPLOYEE_ALLOWED_PATHS.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL('/losses', request.url));
      }
    } catch {
      // cookie corrompido — segue; getSessionUser() no server component trata isso.
    }
  }

  return NextResponse.next();
}

// Protege todas as páginas, exceto assets estáticos internos do Next.js e o
// próprio proxy de API (que faz sua própria checagem de token — ver route.ts).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/backend).*)'],
};

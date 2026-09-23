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
  // master...) volta para /losses. O funcionário designado como conferente
  // ganha também /conferencias. A checagem de verdade continua no backend a
  // cada request; isso aqui é só para não deixar a navegação do painel
  // chegar lá.
  const EMPLOYEE_ALLOWED_PATHS = ['/losses', '/perfil'];
  const VERIFIER_EXTRA_PATHS = ['/conferencias'];
  const userCookie = request.cookies.get(USER_COOKIE)?.value;
  if (userCookie) {
    try {
      const user = JSON.parse(userCookie) as { role?: string; isLossVerifier?: boolean };
      const allowed = user.isLossVerifier
        ? [...EMPLOYEE_ALLOWED_PATHS, ...VERIFIER_EXTRA_PATHS]
        : EMPLOYEE_ALLOWED_PATHS;
      if (user.role === 'employee' && !allowed.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL('/losses', request.url));
      }
    } catch {
      // cookie corrompido — segue; getSessionUser() no server component trata isso.
    }
  }

  return NextResponse.next();
}

// Protege todas as páginas, exceto assets estáticos internos do Next.js, os ícones do
// app, os arquivos da marca (a logo e o favicon precisam carregar já na tela de login,
// antes de existir sessão) e o próprio proxy de API (que faz sua própria checagem de
// token — ver route.ts).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|brand/|api/backend).*)'],
};

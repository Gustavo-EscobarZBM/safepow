import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookies } from '@/lib/session';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const backendResponse = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    return NextResponse.json(
      { message: data?.message || 'Não foi possível entrar.' },
      { status: backendResponse.status },
    );
  }

  // isLossVerifier vem do login do backend fora do objeto `user`; sem levá-lo
  // para a sessão, o menu/middleware não têm como liberar a tela de
  // conferências para o funcionário designado como conferente.
  const sessionUser = { ...data.user, isLossVerifier: data.isLossVerifier === true };
  setSessionCookies(data.accessToken, sessionUser);

  // O token nunca volta para o JavaScript do navegador — só os dados do
  // usuário e o status da empresa (para a tela de login decidir se mostra o
  // aviso de "Vencido" antes de liberar o acesso ao painel).
  return NextResponse.json({
    user: sessionUser,
    companyStatus: data.companyStatus,
    companyDueDate: data.companyDueDate,
  });
}

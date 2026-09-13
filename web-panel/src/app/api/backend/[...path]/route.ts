import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/session';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';

/**
 * Encaminha qualquer chamada de /api/backend/<qualquer-coisa> para
 * `${BACKEND_URL}/<qualquer-coisa>`, anexando o Bearer token lido do cookie
 * httpOnly. O navegador nunca vê o token — só fala com o próprio Next.js,
 * que roda no servidor. Isso também elimina qualquer problema de CORS entre
 * o painel e a API (Seção 2/3 do documento de arquitetura).
 */
async function proxy(request: NextRequest, path: string[]) {
  const token = getAccessToken();
  if (!token) {
    return NextResponse.json({ message: 'Sessão expirada. Faça login novamente.' }, { status: 401 });
  }

  const targetUrl = `${BACKEND_URL}/${path.join('/')}${request.nextUrl.search}`;

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  // Lido como bytes brutos (não texto) para não corromper uploads binários
  // (planilhas .xlsx, fotos) que passam por aqui como multipart/form-data.
  const body = hasBody ? await request.arrayBuffer() : undefined;

  // Encaminha o Content-Type original (incluindo o boundary do multipart)
  // em vez de forçar application/json — senão o backend não consegue
  // interpretar o corpo da requisição corretamente.
  const contentType = request.headers.get('content-type');

  const backendResponse = await fetch(targetUrl, {
    method: request.method,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      Authorization: `Bearer ${token}`,
    },
    body,
    cache: 'no-store',
  });

  // Também lido como bytes brutos: a resposta pode ser um arquivo binário
  // (ex: a exportação de perdas em .xlsx), não só JSON.
  // 204/205/304 são status "sem corpo" — a spec de fetch proíbe passar body
  // (mesmo vazio) num Response com esses status, então o NextResponse tem que
  // ser construído sem body nesses casos (ex: DELETE de empresa no Painel Master).
  const isEmptyBodyStatus = [204, 205, 304].includes(backendResponse.status);
  const responseBuffer = isEmptyBodyStatus ? null : await backendResponse.arrayBuffer();
  const contentTypeResponse = backendResponse.headers.get('content-type') || 'application/json';
  const contentDisposition = backendResponse.headers.get('content-disposition');

  return new NextResponse(responseBuffer, {
    status: backendResponse.status,
    headers: {
      ...(isEmptyBodyStatus ? {} : { 'content-type': contentTypeResponse }),
      ...(contentDisposition ? { 'content-disposition': contentDisposition } : {}),
    },
  });
}

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}
export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}
export async function PATCH(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}
export async function PUT(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}
export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}

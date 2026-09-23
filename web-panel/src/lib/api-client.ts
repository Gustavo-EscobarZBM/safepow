'use client';

export class ApiError extends Error {
  status: number;
  /** Código estável do backend (ex.: 'PRODUCT_ARCHIVED_EXISTS'), quando o corpo de erro trouxer um. */
  errorCode?: string;
  /** Corpo de erro inteiro (ex.: `productId` do conflito com produto arquivado). */
  data: unknown;

  constructor(status: number, message: string, data: unknown = null) {
    super(message);
    this.status = status;
    this.data = data;
    const code = (data as { errorCode?: unknown } | null)?.errorCode;
    this.errorCode = typeof code === 'string' ? code : undefined;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (response.status === 204) {
    if (!response.ok) throw new ApiError(response.status, 'Erro inesperado.');
    return undefined as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 402) {
      throw new ApiError(402, data?.message || 'Acesso suspenso. Assinatura inativa.', data);
    }
    throw new ApiError(response.status, data?.message || 'Erro inesperado.', data);
  }

  return data as T;
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    method: 'POST',
    body: formData, // sem Content-Type manual: o navegador define o boundary do multipart
    cache: 'no-store',
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 402) {
      throw new ApiError(402, data?.message || 'Acesso suspenso. Assinatura inativa.', data);
    }
    throw new ApiError(response.status, data?.message || 'Erro inesperado.', data);
  }

  return data as T;
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(`/api/backend/${path}`, { cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.message || 'Erro ao gerar arquivo.', data);
  }
  return response.blob();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  postForm: <T>(path: string, formData: FormData) => requestForm<T>(path, formData),
  getBlob: (path: string) => requestBlob(path),
};

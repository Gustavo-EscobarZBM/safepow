import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api-client';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body }),
  );
}

describe('ApiError — errorCode e data do corpo de erro', () => {
  afterEach(() => vi.unstubAllGlobals());

  const conflict = {
    statusCode: 409,
    errorCode: 'PRODUCT_ARCHIVED_EXISTS',
    message: 'Existe um produto arquivado com este código de barras.',
    productId: 'p-9',
  };

  it('request (JSON): carrega status, message, errorCode e o corpo em data', async () => {
    mockFetch(409, conflict);

    const error = await api.post('products', { barcode: '1' }).catch((e: ApiError) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: conflict.message, errorCode: 'PRODUCT_ARCHIVED_EXISTS' });
    expect(error.data).toEqual(conflict);
  });

  it('requestForm (multipart): carrega errorCode e data', async () => {
    mockFetch(409, conflict);

    const error = await api.postForm('products/import', new FormData()).catch((e: ApiError) => e);

    expect(error).toMatchObject({ status: 409, errorCode: 'PRODUCT_ARCHIVED_EXISTS' });
    expect(error.data).toEqual(conflict);
  });

  it('corpo sem errorCode (erro antigo ou 500): errorCode fica undefined', async () => {
    mockFetch(500, { statusCode: 500, message: 'Falhou' });

    const error = await api.get('products').catch((e: ApiError) => e);

    expect(error).toMatchObject({ status: 500, message: 'Falhou' });
    expect(error.errorCode).toBeUndefined();
  });

  it('continua aceitando o construtor antigo (status, message)', () => {
    const error = new ApiError(404, 'Não achei');
    expect(error).toMatchObject({ status: 404, message: 'Não achei', data: null });
    expect(error.errorCode).toBeUndefined();
  });
});

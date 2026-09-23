import { describe, expect, it } from 'vitest';
import { productSearchPath } from './product-search';

describe('productSearchPath', () => {
  it('sem busca: não manda q', () => {
    expect(productSearchPath({ q: '', status: 'active', page: 1, pageSize: 20 })).toBe(
      'products/search?status=active&page=1&pageSize=20',
    );
  });

  it('codifica caracteres especiais do texto (%, &, espaço) sem criar parâmetro extra', () => {
    const path = productSearchPath({ q: '100% a&b', status: 'all', page: 2, pageSize: 20 });
    const params = new URLSearchParams(path.split('?')[1]);

    expect(params.get('q')).toBe('100% a&b');
    expect([...params.keys()]).toEqual(['q', 'status', 'page', 'pageSize']);
  });
});

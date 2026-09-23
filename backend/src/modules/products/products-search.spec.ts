// O Nest carrega reflect-metadata na aplicação; num teste isolado, o @Type do class-transformer precisa dele.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchProductsDto } from './dto/search-products.dto';
import { escapeLikePattern } from './products-search';

describe('escapeLikePattern', () => {
  it('escapa %, _ e a barra invertida', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('c:\\x')).toBe('c:\\\\x');
  });

  it('não mexe em texto comum', () => {
    expect(escapeLikePattern('Arroz 5kg')).toBe('Arroz 5kg');
  });
});

describe('SearchProductsDto', () => {
  async function errorsFor(query: Record<string, string>) {
    const dto = plainToInstance(SearchProductsDto, query);
    return { dto, errors: await validate(dto) };
  }

  it('aceita a query completa e converte page/pageSize para número', async () => {
    const { dto, errors } = await errorsFor({ q: 'arroz', status: 'all', page: '2', pageSize: '50', sort: 'updatedAt' });
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(50);
  });

  it.each([
    [{ pageSize: '101' }, 'pageSize'],
    [{ pageSize: '0' }, 'pageSize'],
    [{ page: '0' }, 'page'],
    [{ page: 'abc' }, 'page'],
    [{ page: '100001' }, 'page'],
    [{ status: 'deleted' }, 'status'],
    [{ sort: 'price' }, 'sort'],
    [{ q: 'x'.repeat(101) }, 'q'],
  ])('rejeita %o no campo %s', async (query, field) => {
    const { errors } = await errorsFor(query as Record<string, string>);
    expect(errors.map((e) => e.property)).toContain(field);
  });
});

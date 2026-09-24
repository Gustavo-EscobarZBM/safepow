// O Nest carrega reflect-metadata na aplicação; num teste isolado, o @Type do class-transformer precisa dele.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncProductsQueryDto } from './dto/sync-products.dto';
import { formatSyncCursor, parseSyncCursor } from './products-sync';

const ID = '5f0c8a1e-3b7d-4c2a-9e61-0d2f4b8a7c11';

describe('cursor do sync', () => {
  it('formata e lê de volta sem perder os microssegundos', () => {
    const cursor = formatSyncCursor('2026-09-23T10:00:00.123456Z', ID);
    expect(cursor).toBe(`2026-09-23T10:00:00.123456Z|${ID}`);
    expect(parseSyncCursor(cursor)).toEqual({ afterAt: '2026-09-23T10:00:00.123456Z', afterId: ID });
  });
});

describe('SyncProductsQueryDto', () => {
  async function check(query: Record<string, string>) {
    const dto = plainToInstance(SyncProductsQueryDto, query);
    return { dto, errors: await validate(dto) };
  }

  it('aceita o since que o app instalado manda (microssegundos do Dart)', async () => {
    const { errors } = await check({ since: '2026-09-23T10:00:00.123456Z' });
    expect(errors).toHaveLength(0);
  });

  it('aceita a query completa e converte includeArchived/limit', async () => {
    const { dto, errors } = await check({
      since: '2026-09-23T10:00:00Z',
      includeArchived: 'true',
      limit: '5000',
      after: `2026-09-23T10:00:00.123456Z|${ID}`,
    });
    expect(errors).toHaveLength(0);
    expect(dto.includeArchived).toBe(true);
    expect(dto.limit).toBe(5000);
  });

  it('includeArchived=false vira false (não "truthy")', async () => {
    const { dto, errors } = await check({ includeArchived: 'false' });
    expect(errors).toHaveLength(0);
    expect(dto.includeArchived).toBe(false);
  });

  it.each([
    [{ since: 'ontem' }, 'since'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '10001' }, 'limit'],
    [{ limit: 'abc' }, 'limit'],
    [{ includeArchived: 'sim' }, 'includeArchived'],
    [{ after: 'qualquer-coisa' }, 'after'],
    [{ after: '2026-09-23T10:00:00.123456Z|nao-e-uuid' }, 'after'],
    [{ after: `2026-09-23T10:00:00Z|${ID}` }, 'after'],
  ])('rejeita %o no campo %s', async (query, field) => {
    const { errors } = await check(query as Record<string, string>);
    expect(errors.map((e) => e.property)).toContain(field);
  });
});

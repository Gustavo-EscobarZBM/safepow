# SP1 · Sub-etapa 1.4.1 — Sync correto no backend (`GET /products`) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /products` (sync do app) ganha, de forma retrocompatível, `since` validado,
`includeArchived=true` (tombstones), `limit` e cursor `after` com precisão de microssegundos, mais os
cabeçalhos `X-Sync-Cursor` (relógio do banco) e `X-Next-After`; e um índice `(companyId, updatedAt, id)`.

**Architecture:** Um DTO de query (`SyncProductsQueryDto`) valida os parâmetros; o serviço
`findForSync` mantém **exatamente** a consulta de hoje quando nenhum parâmetro novo vem (app antigo) e,
com parâmetros novos, ordena por `(updatedAt, id)` com continuação por tupla. O cursor é gerado no SQL
(`to_char(... 'US')`) para não perder microssegundos no `Date` do JavaScript (R5). O controller devolve o
array de sempre e só acrescenta cabeçalhos.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL 16, class-validator/class-transformer, Jest 29
(`npm test`, `npm run test:int`).

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md),
seção 6.1 (backend) e 6.3 (testes de backend). O app (6.2) é a sub-etapa **1.4.2**, com plano próprio.

## Global Constraints

- **Spec 6.1 (literal):** `since` validado (`@IsDateString`; hoje um valor inválido vira `Invalid Date` ⇒
  500); `includeArchived=true` inclui `isActive=false` — **só o app novo envia** (R1); `limit` 1–10000, sem
  `limit` = comportamento atual (lista completa); `after` = cursor `"<updatedAt µs ISO>|<id>"` (R5).
  Ordenação `(updatedAt ASC, id ASC)`; continuação `(updatedAt, id) > (:afterAt::timestamptz, :afterId)`;
  cursor gerado no SQL com `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. **Resposta continua sendo um
  array JSON.** Cabeçalhos novos: `X-Sync-Cursor` = `now()` **do banco** no início da requisição;
  `X-Next-After` só quando a página veio cheia. Índice `(companyId, updatedAt, id)` em `products`.
  Importação: sem mudança nesta etapa.
- **Numeração da migration:** `1700000014000-ProductsSyncIndex` (o spec cita `1700000012000`, escrito
  antes de as sub-etapas 1.2.x ocuparem 11000–13000; o número real é o próximo livre).
- **Retrocompatibilidade (A5):** sem `includeArchived`/`limit`/`after`, a resposta é idêntica à de hoje —
  sem `since`: ativos por `name ASC`; com `since`: ativos com `updatedAt > since` por `updatedAt ASC`. O app
  instalado manda só `?since=<DateTime.toUtc().toIso8601String()>` (ex.: `2026-09-23T10:00:00.123456Z`) — esse
  formato tem de continuar aceito.
- Web e app não mudam nesta sub-etapa. Nenhuma outra rota muda.
- **NUNCA rodar `npm run test:int` concorrentemente.** Banco de desenvolvimento: a migration nova só entra
  lá com autorização do usuário (fim da sub-etapa).
- Comandos em `C:\PROJETOS\SAAS\backend`. **Baseline (confirme antes da Task 1):** `npm test` = 20 suítes /
  139; `npm run test:int` = 15 arquivos / 76; `tsc` limpo. Pré-requisito: `docker ps` com
  `backend-postgres-1` healthy.
- **Commits:** branch `feat/cadastros-sp1-etapa-1-4-1` a partir de `main`; um commit por tarefa, mensagem
  terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Merge/push só com confirmação.

## Review Focus

1. **Muitos produtos com o MESMO `updatedAt`** (importação grava milhares na mesma transação) e `limit`
   menor que eles: paginar sem repetir nem perder e sem loop infinito (R5/RK3). → Task 2, teste "25 com o
   mesmo updatedAt, limit 10".
2. **`since` no formato do app instalado** (microssegundos do Dart) continua aceito; valor inválido dá 400,
   não 500. → Task 1 (DTO) e Task 3 (HTTP).
3. **App antigo sem parâmetros novos** recebe exatamente a mesma lista e ordem de hoje. → Task 2, testes
   "legado sem since" e "legado com since".
4. **`X-Next-After` numa página que veio exatamente cheia no fim** (total múltiplo de `limit`): o cliente
   pede mais uma página e recebe `[]` sem cabeçalho — termina, não trava. → Task 2, teste "total múltiplo
   de limit".
5. **Cursor `after` malformado** (texto qualquer, UUID inválido): 400, não 500 de cast no Postgres. →
   Task 1 (DTO) e Task 3 (HTTP).

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/modules/products/dto/sync-products.dto.ts` | criar | validação da query do sync |
| `backend/src/modules/products/products-sync.ts` | criar | formato/parse do cursor, limites |
| `backend/src/modules/products/products-sync.spec.ts` | criar | unitários do DTO e do cursor |
| `backend/src/modules/products/products.service.ts` | modificar | `findForSync` (substitui `findAll`) |
| `backend/src/modules/products/products-sync.int-spec.ts` | criar | sync com Postgres real |
| `backend/src/modules/products/products.controller.ts` | modificar | `GET /products` com DTO e cabeçalhos |
| `backend/src/modules/products/products.http.int-spec.ts` | modificar | HTTP: 400, cabeçalhos, legado |
| `backend/src/database/migrations/1700000014000-ProductsSyncIndex.ts` | criar | índice `(companyId, updatedAt, id)` |
| `backend/src/database/products-sync-index.int-spec.ts` | criar | o índice existe |

---

### Task 1: Query do sync — DTO e cursor

**Files:**
- Create: `backend/src/modules/products/products-sync.ts`
- Create: `backend/src/modules/products/dto/sync-products.dto.ts`
- Create: `backend/src/modules/products/products-sync.spec.ts`

**Interfaces:**
- Produces: `SYNC_MAX_LIMIT = 10000`; `SYNC_CURSOR_PATTERN: RegExp`; `formatSyncCursor(updatedAtUs: string,
  id: string): string` (junta com `|`); `parseSyncCursor(cursor: string): { afterAt: string; afterId: string }`;
  `SYNC_TIMESTAMP_SQL(column: string): string` (a expressão `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  `class SyncProductsQueryDto { since?: string; includeArchived?: boolean; limit?: number; after?: string }`.

- [ ] **Step 1: Branch e baseline**

```bash
cd /c/PROJETOS/SAAS && git checkout main && git checkout -b feat/cadastros-sp1-etapa-1-4-1
cd backend && npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```
Expected: 20/139; 15/76; `tsc exit=0`.

- [ ] **Step 2: Testes (vão falhar)**

Create `backend/src/modules/products/products-sync.spec.ts`:

```ts
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/products/products-sync.spec.ts`
Expected: FAIL — `Cannot find module './dto/sync-products.dto'` (erro de compilação do ts-jest).

- [ ] **Step 4: Implementar**

Create `backend/src/modules/products/products-sync.ts`:

```ts
/** Maior página do sync (spec do SP1, 6.1). */
export const SYNC_MAX_LIMIT = 10000;

/**
 * Cursor de continuação do sync: "<updatedAt com microssegundos, UTC>|<id>". Precisão total de propósito
 * (R5): uma importação grava milhares de produtos com o MESMO updatedAt; um cursor truncado em
 * milissegundos (Date do JavaScript) reentregaria sempre a mesma página.
 */
export const SYNC_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Expressão SQL que formata um timestamptz com microssegundos em UTC (mesmo formato do cursor). */
export function SYNC_TIMESTAMP_SQL(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function formatSyncCursor(updatedAtUs: string, id: string): string {
  return `${updatedAtUs}|${id}`;
}

export function parseSyncCursor(cursor: string): { afterAt: string; afterId: string } {
  const [afterAt, afterId] = cursor.split('|');
  return { afterAt, afterId };
}
```

Create `backend/src/modules/products/dto/sync-products.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { SYNC_CURSOR_PATTERN, SYNC_MAX_LIMIT } from '../products-sync';

/** Query de GET /products (sync do app — spec do SP1, 6.1). Tudo opcional; sem nada = comportamento antigo. */
export class SyncProductsQueryDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  // Query string chega como texto: só "true"/"false" viram booleano; o resto falha na validação.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SYNC_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Matches(SYNC_CURSOR_PATTERN, { message: 'after deve ser um cursor de sync válido' })
  after?: string;
}
```

- [ ] **Step 5: Rodar, checar e commit**

```bash
npx jest src/modules/products/products-sync.spec.ts
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/products/products-sync.ts src/modules/products/dto/sync-products.dto.ts src/modules/products/products-sync.spec.ts
git commit -m "feat(backend): query do sync de produtos (since validado, includeArchived, limit, cursor)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS — 1 + 3 + 8 = 12 testes; `tsc exit=0`.

---

### Task 2: `findForSync` — consulta paginada com tombstones

**Files:**
- Modify: `backend/src/modules/products/products.service.ts` (substituir `findAll`)
- Create: `backend/src/modules/products/products-sync.int-spec.ts`

**Interfaces:**
- Consumes: Task 1 inteira.
- Produces: `interface SyncPage { items: Product[]; syncCursor: string; nextAfter: string | null }`;
  `ProductsService.findForSync(query: SyncProductsQueryDto): Promise<SyncPage>` (substitui
  `findAll(since?)` — o controller é o único chamador, Task 3).

- [ ] **Step 1: Testes (vão falhar)**

Create `backend/src/modules/products/products-sync.int-spec.ts`:

```ts
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll, withTenant } from '../../test-utils/test-db';
import { SyncProductsQueryDto } from './dto/sync-products.dto';
import { ProductsService } from './products.service';

function sync(companyId: string, query: SyncProductsQueryDto) {
  return withTenant({ companyId }, () => new ProductsService().findForSync(query));
}

async function setUpdatedAt(companyId: string, value: string): Promise<void> {
  await adminQuery(`UPDATE products SET "updatedAt" = $2 WHERE "companyId" = $1`, [companyId, value]);
}

async function archive(productId: string): Promise<void> {
  await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);
}

describe('ProductsService.findForSync (Postgres real)', () => {
  let companyId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Sync');
  });
  afterAll(() => closeTestConnections());

  it('legado sem since: só ativos, por nome — igual ao GET /products de antes', async () => {
    await seedProduct({ companyId, barcode: '2', name: 'Banana' });
    await seedProduct({ companyId, barcode: '1', name: 'Abacate' });
    await archive(await seedProduct({ companyId, barcode: '3', name: 'Arquivado' }));

    const page = await sync(companyId, {});

    expect(page.items.map((p) => p.name)).toEqual(['Abacate', 'Banana']);
    expect(page.nextAfter).toBeNull();
  });

  it('legado com since: só ativos alterados depois, por updatedAt', async () => {
    const old = await seedProduct({ companyId, barcode: '1', name: 'Antigo' });
    const recent = await seedProduct({ companyId, barcode: '2', name: 'Recente' });
    await adminQuery(`UPDATE products SET "updatedAt" = '2026-01-01T00:00:00Z' WHERE id = $1`, [old]);
    await adminQuery(`UPDATE products SET "updatedAt" = '2026-09-01T00:00:00Z' WHERE id = $1`, [recent]);

    const page = await sync(companyId, { since: '2026-06-01T00:00:00.123456Z' });

    expect(page.items.map((p) => p.name)).toEqual(['Recente']);
  });

  it('includeArchived=true traz os arquivados (tombstones) com isActive=false', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Ativo' });
    await archive(await seedProduct({ companyId, barcode: '2', name: 'Arquivado' }));

    const page = await sync(companyId, { includeArchived: true });

    expect(page.items.map((p) => [p.name, p.isActive]).sort()).toEqual([
      ['Arquivado', false],
      ['Ativo', true],
    ]);
  });

  it('25 produtos com o MESMO updatedAt e limit 10: três páginas, sem repetir nem perder, sem loop', async () => {
    for (let i = 1; i <= 25; i += 1) {
      await seedProduct({ companyId, barcode: `${1000 + i}`, name: `P${i}` });
    }
    await setUpdatedAt(companyId, '2026-09-01T10:00:00.123456Z');

    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await sync(companyId, { includeArchived: true, limit: 10, after });
      seen.push(...page.items.map((p) => p.id));
      after = page.nextAfter ?? undefined;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(4); // trava de segurança contra loop
    } while (after);

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(pages).toBe(3);
  });

  it('total múltiplo de limit: a página cheia manda nextAfter; a seguinte vem vazia e sem nextAfter', async () => {
    for (let i = 1; i <= 4; i += 1) {
      await seedProduct({ companyId, barcode: `${2000 + i}`, name: `Q${i}` });
    }

    const first = await sync(companyId, { includeArchived: true, limit: 2 });
    const second = await sync(companyId, { includeArchived: true, limit: 2, after: first.nextAfter! });
    const third = await sync(companyId, { includeArchived: true, limit: 2, after: second.nextAfter! });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(second.nextAfter).not.toBeNull();
    expect(third.items).toEqual([]);
    expect(third.nextAfter).toBeNull();
  });

  it('o cursor tem microssegundos do banco (não é truncado em milissegundos)', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Único' });
    await setUpdatedAt(companyId, '2026-09-01T10:00:00.123456Z');

    const page = await sync(companyId, { limit: 1, includeArchived: true });

    expect(page.nextAfter).toMatch(/^2026-09-01T10:00:00\.123456Z\|/);
  });

  it('syncCursor é o now() do banco no início da transação, com microssegundos', async () => {
    const before = (await adminQuery(`SELECT now() AS n`))[0].n as Date;

    const page = await sync(companyId, {});

    expect(page.syncCursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(new Date(page.syncCursor).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
  });

  it('RLS: nunca devolve produtos de outra empresa, nem como tombstone', async () => {
    const other = await seedCompany('Outra Sync');
    await seedProduct({ companyId, barcode: '1', name: 'Meu' });
    await archive(await seedProduct({ companyId: other, barcode: '2', name: 'Dela' }));

    const page = await sync(companyId, { includeArchived: true });

    expect(page.items.map((p) => p.name)).toEqual(['Meu']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/products/products-sync.int-spec.ts`
Expected: FAIL — erro de compilação `Property 'findForSync' does not exist on type 'ProductsService'`.

- [ ] **Step 3: Implementar**

Modify `backend/src/modules/products/products.service.ts`:
- imports:
```ts
import { SyncProductsQueryDto } from './dto/sync-products.dto';
import { formatSyncCursor, parseSyncCursor, SYNC_TIMESTAMP_SQL } from './products-sync';
```
- antes de `@Injectable()` (depois de `PRICE_HISTORY_LIMIT`):
```ts
export interface SyncPage {
  items: Product[];
  /** now() do banco no início da requisição — o app guarda isto como "sincronizado até" (não o relógio dele). */
  syncCursor: string;
  /** Cursor para a próxima página; só quando esta veio cheia (há, ou pode haver, mais). */
  nextAfter: string | null;
}
```
- substituir o método `findAll(sinceIso?: string)` inteiro por:
```ts
  /**
   * Catálogo para o sync do app (Seção 4.3 do documento; SP1, 6.1). Sem os parâmetros novos, a consulta é
   * exatamente a de antes (app instalado). Com eles: tombstones opcionais (R1) e páginas por cursor com
   * precisão de microssegundos e desempate por id (R5) — produtos com o mesmo updatedAt nunca repetem nem
   * somem entre páginas.
   */
  async findForSync(query: SyncProductsQueryDto): Promise<SyncPage> {
    const manager = getTenantManager();
    const [{ cursor: syncCursor }] = await manager.query(
      `SELECT ${SYNC_TIMESTAMP_SQL('now()')} AS cursor`,
    );

    const legacy = query.includeArchived === undefined && query.limit === undefined && query.after === undefined;
    if (legacy) {
      const items = query.since
        ? await manager
            .createQueryBuilder(Product, 'product')
            .where('product.isActive = true')
            .andWhere('product.updatedAt > :since', { since: new Date(query.since) })
            .orderBy('product.updatedAt', 'ASC')
            .getMany()
        : await manager.find(Product, { where: { isActive: true }, order: { name: 'ASC' } });
      return { items, syncCursor, nextAfter: null };
    }

    const qb = manager
      .createQueryBuilder(Product, 'product')
      .addSelect(SYNC_TIMESTAMP_SQL('product.updatedAt'), 'sync_updated_at');
    if (!query.includeArchived) qb.andWhere('product.isActive = true');
    if (query.since) qb.andWhere('product.updatedAt > :since', { since: new Date(query.since) });
    if (query.after) {
      const { afterAt, afterId } = parseSyncCursor(query.after);
      qb.andWhere('(product.updatedAt, product.id) > (CAST(:afterAt AS timestamptz), CAST(:afterId AS uuid))', {
        afterAt,
        afterId,
      });
    }
    qb.orderBy('product.updatedAt', 'ASC').addOrderBy('product.id', 'ASC');
    if (query.limit) qb.limit(query.limit);

    const { entities, raw } = await qb.getRawAndEntities<{ sync_updated_at: string }>();
    const full = query.limit !== undefined && entities.length === query.limit;
    const last = entities.length - 1;
    const nextAfter = full ? formatSyncCursor(raw[last].sync_updated_at, entities[last].id) : null;
    return { items: entities, syncCursor, nextAfter };
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:int -- src/modules/products/products-sync.int-spec.ts`
Expected: PASS — 8 testes. (O controller ainda chama `findAll` — o `tsc` quebra até a Task 3; por isso o
commit desta tarefa vai junto com a Task 3.)

---

### Task 3: `GET /products` com o DTO e os cabeçalhos

**Files:**
- Modify: `backend/src/modules/products/products.controller.ts`
- Modify: `backend/src/modules/products/products.http.int-spec.ts`

**Interfaces:**
- Consumes: `findForSync`, `SyncPage` (Task 2); `SyncProductsQueryDto` (Task 1).
- Produces: contrato HTTP final do sync, consumido pelo app na 1.4.2.

- [ ] **Step 1: Testes HTTP (vão falhar)**

Modify `backend/src/modules/products/products.http.int-spec.ts`:

1. No helper `request`, trocar o tipo de retorno e o `return` para incluir os cabeçalhos:
```ts
): Promise<{ status: number; body: any; headers: Headers }> {
```
```ts
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
```
2. Ao fim do `describe` principal:
```ts
  it('GET /products (sync) sem parâmetros: array de ativos por nome + X-Sync-Cursor, sem X-Next-After', async () => {
    await seedProduct({ companyId, barcode: '901', name: 'Banana' });
    await seedProduct({ companyId, barcode: '900', name: 'Abacate' });

    const { status, body, headers } = await request(baseUrl, 'GET', '/api/products', employeeToken);

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((p: { name: string }) => p.name)).toEqual(['Abacate', 'Banana']);
    expect(headers.get('x-sync-cursor')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(headers.get('x-next-after')).toBeNull();
  });

  it('GET /products?since=<formato do app instalado> continua aceito (200)', async () => {
    const { status } = await request(baseUrl, 'GET', '/api/products?since=2026-09-23T10:00:00.123456Z', employeeToken);
    expect(status).toBe(200);
  });

  it('GET /products com página cheia manda X-Next-After', async () => {
    await seedProduct({ companyId, barcode: '910', name: 'A' });
    await seedProduct({ companyId, barcode: '911', name: 'B' });

    const { status, body, headers } = await request(
      baseUrl,
      'GET',
      '/api/products?includeArchived=true&limit=1',
      employeeToken,
    );

    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(headers.get('x-next-after')).toMatch(/\|[0-9a-f-]{36}$/);
  });

  it.each(['since=ontem', 'limit=0', 'limit=10001', 'includeArchived=sim', 'after=lixo', 'foo=bar'])(
    'GET /products?%s ⇒ 400 (não 500)',
    async (query) => {
      const { status } = await request(baseUrl, 'GET', `/api/products?${query}`, employeeToken);
      expect(status).toBe(400);
    },
  );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/products/products.http.int-spec.ts`
Expected: a compilação falha (o controller ainda chama `findAll`, que não existe mais — é o sinal de que
a Task 2 exige esta). Se a compilação passar por algum motivo, os testes novos falham por falta dos
cabeçalhos e por `since=ontem` dar 500.

- [ ] **Step 3: Implementar**

Modify `backend/src/modules/products/products.controller.ts`:
- imports: `Res` em `@nestjs/common`; `import { Response } from 'express';`;
  `import { SyncProductsQueryDto } from './dto/sync-products.dto';`
- substituir o handler `findAll` (o `@Get()` sem caminho) por:
```ts
  // Consultado tanto pelo painel quanto pelo app (sincronização de catálogo — Seção 4.3). A resposta
  // continua sendo um array; os parâmetros e cabeçalhos novos (SP1, 6.1) são opcionais — o app antigo
  // manda só ?since= e recebe exatamente o que recebia.
  @Get()
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  async findAll(@Query() query: SyncProductsQueryDto, @Res({ passthrough: true }) res: Response) {
    const page = await this.productsService.findForSync(query);
    res.setHeader('X-Sync-Cursor', page.syncCursor);
    if (page.nextAfter) res.setHeader('X-Next-After', page.nextAfter);
    return page.items;
  }
```

- [ ] **Step 4: Rodar, checar e commit (Tasks 2 e 3 juntas)**

```bash
npm run test:int -- src/modules/products/products.http.int-spec.ts src/modules/products/products-sync.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
grep -rn "findAll(" src/modules/products
git add src/modules/products/products.service.ts src/modules/products/products-sync.int-spec.ts src/modules/products/products.controller.ts src/modules/products/products.http.int-spec.ts
git commit -m "feat(backend): sync de produtos paginado por cursor, com tombstones opcionais e X-Sync-Cursor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS (HTTP 11 + 3 + 6 = 20; sync 8); unitário 21/151; integração 16/104; `tsc exit=0`; o `grep`
só mostra o handler do controller.

---

### Task 4: Índice `(companyId, updatedAt, id)` e registro do andamento

**Files:**
- Create: `backend/src/database/migrations/1700000014000-ProductsSyncIndex.ts`
- Create: `backend/src/database/products-sync-index.int-spec.ts`
- Modify: `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` (seção 6)
- Modify: `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10)

- [ ] **Step 1: Teste (vai falhar)**

Create `backend/src/database/products-sync-index.int-spec.ts`:

```ts
import { adminQuery, closeTestConnections } from '../test-utils/test-db';

describe('índice do sync de produtos (migration 1700000014000)', () => {
  afterAll(() => closeTestConnections());

  it('existe um índice em products (companyId, updatedAt, id)', async () => {
    const rows = await adminQuery(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'products' AND indexname = 'idx_products_company_updated_id'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('("companyId", "updatedAt", id)');
  });
});
```

Run: `npm run test:int -- src/database/products-sync-index.int-spec.ts`
Expected: FAIL — `Expected length: 1, Received length: 0`.

- [ ] **Step 2: Migration**

Create `backend/src/database/migrations/1700000014000-ProductsSyncIndex.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice do sync de produtos (SP1, 6.1): o GET /products paginado filtra por empresa (RLS) e ordena por
 * (updatedAt, id) com continuação por tupla — este índice atende as duas coisas. O spec citava o número
 * 1700000012000, escrito antes de as sub-etapas 1.2.x ocuparem 11000–13000.
 */
export class ProductsSyncIndex1700000014000 implements MigrationInterface {
  name = 'ProductsSyncIndex1700000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_products_company_updated_id" ON "products" ("companyId", "updatedAt", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_company_updated_id"`);
  }
}
```

Run: `npm run test:int -- src/database/products-sync-index.int-spec.ts`
Expected: PASS — 1 teste.

- [ ] **Step 3: Registrar o andamento**

Modify `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` — no fim da seção 6.3 (antes de
`**Pronto quando:**` da seção 6):
```markdown
**Divisão da etapa (2026-09-24):** 1.4.1 = backend (6.1 e testes de backend de 6.3); 1.4.2 = app (6.2 e
testes do app). **Resultado da 1.4.1 (<data>):** `GET /products` com `SyncProductsQueryDto` (`since`
validado — aceita o formato do Dart; `includeArchived`, `limit` 1–10000, `after` com microssegundos) e
`findForSync` (sem parâmetros novos = consulta antiga, idêntica); cabeçalhos `X-Sync-Cursor` (now() do
banco) e `X-Next-After` (só página cheia); migration `1700000014000-ProductsSyncIndex` (o spec citava
12000, número já usado). Paginação com o mesmo updatedAt coberta por teste de regressão (R5).
```
E, na seção 10 do mestre, a linha do SP1: "Etapa 1.4 dividida em 1.4.1 (backend) e 1.4.2 (app); 1.4.1
concluída em <data> (branch feat/cadastros-sp1-etapa-1-4-1)", link do plano, baselines de backend.

- [ ] **Step 4: Checagem final e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
cd /c/PROJETOS/SAAS
git add backend/src/database/migrations/1700000014000-ProductsSyncIndex.ts backend/src/database/products-sync-index.int-spec.ts docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "feat(backend): índice (companyId, updatedAt, id) para o sync; andamento da 1.4.1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 21/151; 17/105; `tsc exit=0`.

**Banco de desenvolvimento:** a migration 14000 só é aplicada em `inventory_saas` com autorização do
usuário (é só um `CREATE INDEX` — rápido no volume de desenvolvimento). Perguntar ao final.

---

## Auto-revisão

**Cobertura do spec (6.1 e testes de backend de 6.3):** `since` validado → Task 1 (+ HTTP 400 na Task 3);
`includeArchived` → Tasks 1 e 2; `limit` 1–10000 e "sem limit = atual" → Tasks 1 e 2 (legado); `after` com
µs → Tasks 1 e 2; ordenação e continuação por tupla → Task 2; cursor gerado no SQL → Tasks 1 e 2; resposta
array + `X-Sync-Cursor`/`X-Next-After` → Tasks 2 e 3; índice → Task 4. Testes 6.3: mesmo `updatedAt` >
`limit` (Task 2), `includeArchived` liga/desliga (Task 2), resposta idêntica sem parâmetros novos (Tasks 2 e
3), `since` inválido ⇒ 400 (Task 3), cabeçalhos presentes (Task 3).

**Review Focus:** 1 e 4 → Task 2; 2 → Tasks 1 e 3; 3 → Tasks 2 e 3; 5 → Tasks 1 e 3.

**Decisões deste plano:** migration numerada 14000 (spec desatualizado); `includeArchived` só aceita
`true`/`false` literais; Tasks 2 e 3 num só commit (a remoção de `findAll` quebra o controller até a Task 3).

**Placeholders:** `<data>` na Task 4 é preenchido na execução.

**Consistência:** `SyncProductsQueryDto`, `formatSyncCursor`/`parseSyncCursor`/`SYNC_TIMESTAMP_SQL`/
`SYNC_CURSOR_PATTERN`/`SYNC_MAX_LIMIT` (Task 1), `findForSync`/`SyncPage` (Task 2) — mesmos nomes onde
reaparecem.

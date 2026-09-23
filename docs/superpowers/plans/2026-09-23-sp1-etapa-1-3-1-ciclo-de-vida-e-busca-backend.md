# SP1 · Sub-etapa 1.3.1 — Ciclo de vida do produto e busca no servidor (backend) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Os contratos de backend da etapa 1.3: conflito de código de barras com `errorCode` (ativo ×
arquivado), `PATCH /products/:id/restore`, `GET /products/search` paginado no servidor, `findByBarcode`
só com ativos e a importação reativando produto arquivado.

**Architecture:** Tudo aditivo (A5): `DELETE` continua arquivando, `GET /products` (sync) não muda. A
busca é um `QueryBuilder` com `ILIKE`/`LIKE` e escape de curingas; a validação da query é um DTO com
`class-validator` + `class-transformer` (o `ValidationPipe` global já tem `transform: true`). Os
contratos HTTP (corpo do 409, validação da query, ordem das rotas) são testados numa aplicação Nest real
montada com `@nestjs/testing`, com o `TenantContextMiddleware` real sobre o Postgres de teste.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL 16, class-validator/class-transformer, Jest 29
(unitário `npm test`; integração `npm run test:int`), Node 24 (`fetch` nativo).

**Spec:** [`docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md`](../specs/2026-09-20-sp1-fundacao-de-dados-design.md),
seção 5.1 (contratos) e 5.3 (testes, parte de backend). A parte web (5.2) é a sub-etapa **1.3.2**, com
plano próprio depois desta.

## Global Constraints

- **Contratos (spec 5.1, literais):**
  - `POST /products` conflito ⇒ `409 { statusCode, errorCode, message, productId? }`; `errorCode` =
    `PRODUCT_BARCODE_EXISTS` (ativo) ou `PRODUCT_ARCHIVED_EXISTS` (arquivado, com `productId`).
  - `PATCH /products/:id/restore` (gerente): reativa (`isActive = true`), devolve o produto.
  - `DELETE /products/:id`: inalterado (204), arquiva.
  - `GET /products/search` (gerente): `?q=&status=active|archived|all&page=&pageSize=&sort=name|updatedAt`
    → `{ items, total, page, pageSize }`; padrão `status=active`, `pageSize` 20 (máx. 100); `q` procura em
    nome (`ILIKE`), prefixo do código de barras e SKU, escapando `%`, `_`, `\`.
  - `GET /products/barcode/:barcode`: só **ativos**.
  - `GET /products` (sync): **inalterado** (a 1.4 mexe nele).
  - `PATCH /products/:id` continua permitido para arquivados.
  - Rotas estáticas (`search`) declaradas **antes** de qualquer rota paramétrica.
  - Importação: o upsert de produto existente passa a `isActive = true`.
- Web e app não mudam nesta sub-etapa.
- Migrations: nenhuma nova.
- **NUNCA rodar `npm run test:int` concorrentemente.** Banco de desenvolvimento não é tocado pelos testes.
- Comandos a partir de `C:\PROJETOS\SAAS\backend`. **Baseline (confirme antes da Task 1):** `npm test` =
  19 suítes / 120 testes; `npm run test:int` = 12 arquivos / 49 testes; `npx tsc --noEmit -p
  tsconfig.json` limpo. Números dos steps = "baseline + N".
- **Commits:** branch `feat/cadastros-sp1-etapa-1-3-1` a partir de `main`; um commit por tarefa, mensagem
  terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Merge/push só com confirmação.

## Review Focus

1. **Texto de busca com curingas** (`%`, `_`, `\`) — o gerente digita "100%" ou "a_b": tem de procurar o
   texto literal, nunca virar "tudo". → Task 3, testes de integração "`%` literal", "`_` literal" e
   "barra invertida literal".
2. **`pageSize`/`page` fora da faixa ou não numéricos na URL** (`pageSize=500`, `page=0`, `page=abc`):
   400 com mensagem, não 500 nem consulta gigante. → Task 3, testes HTTP e do DTO.
3. **Rota `search` confundida com `:id`** (ex.: `GET /products/search` caindo num handler paramétrico e
   dando 400 de UUID): → Task 3, teste HTTP "`/products/search` responde a busca".
4. **Reativar produto de outra empresa ou inexistente:** 404, sem vazar existência. → Task 2, teste de
   integração com RLS.
5. **Cadastro concorrente do mesmo código** (dois cliques rápidos): o segundo recebe 409 com
   `PRODUCT_BARCODE_EXISTS`, não 500 da violação do índice único. → Task 1, teste unitário que simula a
   violação `23505` no `save`.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/modules/products/products.service.ts` | modificar | `create` (errorCode), `restore`, `findByBarcode` só ativos, `search` |
| `backend/src/modules/products/products.controller.ts` | modificar | rotas `search` e `:id/restore` |
| `backend/src/modules/products/product-errors.ts` | criar | códigos de erro e fábrica das exceções de conflito |
| `backend/src/modules/products/products-search.ts` | criar | `escapeLikePattern`, `DEFAULT_PAGE_SIZE`, `ProductSearchResult` |
| `backend/src/modules/products/dto/search-products.dto.ts` | criar | validação da query da busca |
| `backend/src/modules/products/products.service.spec.ts` | modificar | unitários de create/restore/findByBarcode |
| `backend/src/modules/products/products-search.spec.ts` | criar | unitários de `escapeLikePattern` e do DTO |
| `backend/src/modules/products/products-lifecycle.int-spec.ts` | criar | restore/findByBarcode com Postgres real |
| `backend/src/modules/products/products-search.int-spec.ts` | criar | busca com Postgres real |
| `backend/src/modules/products/products.http.int-spec.ts` | criar | contratos HTTP numa app Nest real |
| `backend/src/modules/imports/imports.processor.ts` | modificar | reativa no upsert |
| `backend/src/modules/imports/imports.processor.int-spec.ts` | modificar | teste de reativação |

---

### Task 1: Conflito de código de barras com `errorCode`

**Files:**
- Create: `backend/src/modules/products/product-errors.ts`
- Modify: `backend/src/modules/products/products.service.ts` (`create`)
- Test: `backend/src/modules/products/products.service.spec.ts`
- Create: `backend/src/modules/products/products.http.int-spec.ts`

**Interfaces:**
- Produces: `ProductErrorCode` (`{ BARCODE_EXISTS: 'PRODUCT_BARCODE_EXISTS', ARCHIVED_EXISTS:
  'PRODUCT_ARCHIVED_EXISTS' }`), `barcodeConflict(existing: Pick<Product, 'id' | 'isActive'>):
  ConflictException` em `product-errors.ts`; e, em `products.http.int-spec.ts`, os helpers `startApp()`,
  `request(method, path, token, body?)`, `tokenFor(ctx)` e `JWT_SECRET` — que as Tasks 2 e 3 reutilizam
  acrescentando testes ao mesmo arquivo.

- [ ] **Step 1: Branch e baseline**

```bash
cd /c/PROJETOS/SAAS && git checkout main && git checkout -b feat/cadastros-sp1-etapa-1-3-1
cd backend && npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```
Expected: 19/120; 12/49; `tsc exit=0`.

- [ ] **Step 2: Testes unitários (vão falhar)**

Modify `backend/src/modules/products/products.service.spec.ts` — acrescentar `ConflictException` ao
import de `@nestjs/common` (criar a linha `import { ConflictException, NotFoundException } from
'@nestjs/common';` no topo) e, no fim do arquivo:

```ts
describe('ProductsService.create — conflito de código de barras (etapa 1.3)', () => {
  function managerWithExisting(existing: object | null, saveError?: unknown) {
    return {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: saveError ? jest.fn().mockRejectedValue(saveError) : jest.fn(),
    };
  }

  it('código de um produto ATIVO ⇒ 409 PRODUCT_BARCODE_EXISTS', async () => {
    const manager = managerWithExisting({ id: 'prod-1', isActive: true });

    const error = await runWithTenantContext(manager, () =>
      new ProductsService().create({ barcode: '123', name: 'Arroz' }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      errorCode: 'PRODUCT_BARCODE_EXISTS',
      message: 'Já existe um produto com este código de barras.',
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('código de um produto ARQUIVADO ⇒ 409 PRODUCT_ARCHIVED_EXISTS com o productId', async () => {
    const manager = managerWithExisting({ id: 'prod-9', isActive: false });

    const error = await runWithTenantContext(manager, () =>
      new ProductsService().create({ barcode: '123', name: 'Arroz' }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      errorCode: 'PRODUCT_ARCHIVED_EXISTS',
      message: 'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
      productId: 'prod-9',
    });
  });

  it('cadastro concorrente (índice único viola no save) ⇒ 409 PRODUCT_BARCODE_EXISTS, não 500', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), {
      driverError: { code: '23505', constraint: 'uq_products_company_barcode' },
    });
    const manager = managerWithExisting(null, uniqueViolation);

    const error = await runWithTenantContext(manager, () =>
      new ProductsService().create({ barcode: '123', name: 'Arroz' }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ errorCode: 'PRODUCT_BARCODE_EXISTS' });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/products/products.service.spec.ts`
Expected: FAIL nos 3 testes novos — o 1º e o 2º porque `getResponse()` hoje é `{ statusCode: 409, message,
error: 'Conflict' }` (sem `errorCode`), o 3º porque o erro do `save` sai cru (não é `ConflictException`).

- [ ] **Step 4: Implementar**

Create `backend/src/modules/products/product-errors.ts`:

```ts
import { ConflictException, HttpStatus } from '@nestjs/common';
import { Product } from './product.entity';

/** Códigos estáveis que o painel usa para decidir o que oferecer (spec do SP1, seção 5.1). */
export const ProductErrorCode = {
  BARCODE_EXISTS: 'PRODUCT_BARCODE_EXISTS',
  ARCHIVED_EXISTS: 'PRODUCT_ARCHIVED_EXISTS',
} as const;

/** Nome do índice único (companyId, barcode) — migration InitialSchema. */
export const PRODUCT_BARCODE_UNIQUE_INDEX = 'uq_products_company_barcode';

/**
 * 409 do cadastro: produto ativo com o mesmo código ⇒ só avisa; ARQUIVADO ⇒ devolve o id para o painel
 * oferecer "Reativar e atualizar os dados" em vez de um beco sem saída (F2).
 */
export function barcodeConflict(existing: Pick<Product, 'id' | 'isActive'> | null): ConflictException {
  if (existing && !existing.isActive) {
    return new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      errorCode: ProductErrorCode.ARCHIVED_EXISTS,
      message: 'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
      productId: existing.id,
    });
  }
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    errorCode: ProductErrorCode.BARCODE_EXISTS,
    message: 'Já existe um produto com este código de barras.',
  });
}

/** Violação do índice único de código de barras (cadastro concorrente que passou pela checagem prévia). */
export function isBarcodeUniqueViolation(error: unknown): boolean {
  const driverError = (error as { driverError?: { code?: string; constraint?: string } })?.driverError;
  return driverError?.code === '23505' && driverError.constraint === PRODUCT_BARCODE_UNIQUE_INDEX;
}
```

Modify `backend/src/modules/products/products.service.ts`:
- import: `import { barcodeConflict, isBarcodeUniqueViolation } from './product-errors';`
- em `create`, trocar
```ts
    if (existing) {
      throw new ConflictException('Já existe um produto com este código de barras.');
    }
```
por
```ts
    if (existing) {
      throw barcodeConflict(existing);
    }
```
e trocar o `return manager.save(product);` do `create` por:
```ts
    try {
      return await manager.save(product);
    } catch (error) {
      // Dois cadastros simultâneos do mesmo código: o segundo passa pela checagem acima e esbarra no
      // índice único — responde o mesmo 409 em vez de 500.
      if (isBarcodeUniqueViolation(error)) throw barcodeConflict(null);
      throw error;
    }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/products/products.service.spec.ts`
Expected: PASS — 5 testes (2 existentes + 3 novos).

- [ ] **Step 6: Teste HTTP do corpo do 409 (vai falhar) — cria o harness HTTP**

Create `backend/src/modules/products/products.http.int-spec.ts`:

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantContextMiddleware } from '../../common/tenant/tenant-context.middleware';
import {
  adminQuery,
  appDataSource,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
} from '../../test-utils/test-db';
import { UserRole } from '../users/user.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

const JWT_SECRET = 'segredo-somente-de-teste';

/**
 * App Nest real (controller, guards de JWT/papel, ValidationPipe igual ao main.ts, TenantContextMiddleware
 * real sobre o Postgres de teste). Só o SubscriptionGuard é trocado — ele injeta o repositório de Company,
 * e a assinatura não é o que estes testes verificam.
 */
async function startApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProductsController],
    providers: [ProductsService],
  })
    .overrideGuard(SubscriptionGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  const middleware = new TenantContextMiddleware(new JwtService({ secret: JWT_SECRET }), await appDataSource());
  app.use((req: Request, res: Response, next: NextFunction) => void middleware.use(req, res, next));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

function tokenFor(ctx: { userId: string; companyId: string; role: UserRole }): Promise<string> {
  return new JwtService({ secret: JWT_SECRET }).signAsync({ sub: ctx.userId, role: ctx.role, companyId: ctx.companyId });
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function seedUser(companyId: string, role: 'manager' | 'employee'): Promise<string> {
  return (
    await adminQuery(
      `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [`Usuário ${role}`, `${role}-${companyId}@teste.local`, role, companyId],
    )
  )[0].id;
}

describe('ProductsController — contratos HTTP (etapa 1.3)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let managerToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa HTTP');
    managerToken = await tokenFor({ userId: await seedUser(companyId, 'manager'), companyId, role: UserRole.MANAGER });
    employeeToken = await tokenFor({ userId: await seedUser(companyId, 'employee'), companyId, role: UserRole.EMPLOYEE });
  });

  it('POST /products com código de produto ARQUIVADO ⇒ 409 com errorCode e productId no corpo', async () => {
    const archivedId = await seedProduct({ companyId, barcode: '789' });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archivedId]);

    const { status, body } = await request(baseUrl, 'POST', '/api/products', managerToken, {
      barcode: '789',
      name: 'Arroz 5kg',
    });

    expect(status).toBe(409);
    expect(body).toEqual({
      statusCode: 409,
      errorCode: 'PRODUCT_ARCHIVED_EXISTS',
      message: 'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
      productId: archivedId,
    });
  });
});
```

(`employeeToken` é usado pelos testes que as Tasks 2 e 3 acrescentam neste mesmo `describe`.)

- [ ] **Step 7: Rodar**

Run: `npm run test:int -- src/modules/products/products.http.int-spec.ts`
Expected: PASS — 1 teste (a implementação do Step 4 já está no lugar; este teste fixa o **formato do
corpo HTTP**, que o unitário não enxerga). Se falhar por algo do harness (ex.: `getUrl`, guarda), corrija
o harness antes de seguir — as Tasks 2 e 3 dependem dele. **Prova de sensibilidade:** troque
temporariamente `throw barcodeConflict(existing);` por `throw new ConflictException('x');`, rode e veja
FAIL; desfaça.

- [ ] **Step 8: Checagem e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/products/product-errors.ts src/modules/products/products.service.ts src/modules/products/products.service.spec.ts src/modules/products/products.http.int-spec.ts
git commit -m "feat(backend): conflito de código de barras com errorCode (ativo x arquivado)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 19/123; 13/50; `tsc exit=0`.

---

### Task 2: `restore` e `findByBarcode` só com ativos

**Files:**
- Modify: `backend/src/modules/products/products.service.ts`
- Modify: `backend/src/modules/products/products.controller.ts`
- Test: `backend/src/modules/products/products.service.spec.ts`
- Create: `backend/src/modules/products/products-lifecycle.int-spec.ts`
- Modify: `backend/src/modules/products/products.http.int-spec.ts`

**Interfaces:**
- Consumes: harness HTTP da Task 1 (`request`, `baseUrl`, `managerToken`, `employeeToken`, `companyId`).
- Produces: `ProductsService.restore(id: string): Promise<Product>`; rota `PATCH /products/:id/restore`.

- [ ] **Step 1: Testes (vão falhar)**

Modify `backend/src/modules/products/products.service.spec.ts` — acrescentar ao fim:

```ts
describe('ProductsService.restore e findByBarcode (etapa 1.3)', () => {
  it('restore reativa um produto arquivado e devolve o produto', async () => {
    const product = { id: 'prod-1', isActive: false };
    const manager = {
      findOne: jest.fn().mockResolvedValue(product),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () => new ProductsService().restore('prod-1'));

    expect(result).toMatchObject({ id: 'prod-1', isActive: true });
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it('restore de produto já ativo é idempotente: devolve sem regravar', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: 'prod-1', isActive: true }),
      save: jest.fn(),
    };

    const result = await runWithTenantContext(manager, () => new ProductsService().restore('prod-1'));

    expect(result).toMatchObject({ isActive: true });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('restore de produto inexistente ⇒ NotFoundException', async () => {
    const manager = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };

    await expect(runWithTenantContext(manager, () => new ProductsService().restore('x'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

Create `backend/src/modules/products/products-lifecycle.int-spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { ProductsService } from './products.service';

async function archive(productId: string): Promise<void> {
  await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);
}

describe('ciclo de vida do produto — restore e findByBarcode (Postgres real)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('restore reativa e é idempotente (duas chamadas seguidas dão o mesmo resultado)', async () => {
    const companyId = await seedCompany('Empresa Ciclo');
    const productId = await seedProduct({ companyId, barcode: '1001' });
    await archive(productId);

    const first = await withTenant({ companyId }, () => new ProductsService().restore(productId));
    const second = await withTenant({ companyId }, () => new ProductsService().restore(productId));

    expect(first.isActive).toBe(true);
    expect(second.isActive).toBe(true);
    const [row] = await adminQuery(`SELECT "isActive" FROM products WHERE id = $1`, [productId]);
    expect(row.isActive).toBe(true);
  });

  it('restore de produto de OUTRA empresa ⇒ 404 (a RLS esconde) e nada muda', async () => {
    const a = await seedCompany('Empresa A Ciclo');
    const b = await seedCompany('Empresa B Ciclo');
    const productOfB = await seedProduct({ companyId: b, barcode: '1002' });
    await archive(productOfB);

    await expect(withTenant({ companyId: a }, () => new ProductsService().restore(productOfB))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const [row] = await adminQuery(`SELECT "isActive" FROM products WHERE id = $1`, [productOfB]);
    expect(row.isActive).toBe(false);
  });

  it('findByBarcode não devolve produto arquivado (F11)', async () => {
    const companyId = await seedCompany('Empresa Barcode');
    const productId = await seedProduct({ companyId, barcode: '1003' });
    await archive(productId);

    await expect(
      withTenant({ companyId }, () => new ProductsService().findByBarcode('1003')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByBarcode continua devolvendo produto ativo', async () => {
    const companyId = await seedCompany('Empresa Barcode Ativo');
    const productId = await seedProduct({ companyId, barcode: '1004' });

    const found = await withTenant({ companyId }, () => new ProductsService().findByBarcode('1004'));

    expect(found.id).toBe(productId);
  });
});
```

Modify `backend/src/modules/products/products.http.int-spec.ts` — dentro do `describe`, depois do teste
existente:

```ts
  it('PATCH /products/:id/restore reativa e devolve o produto (200)', async () => {
    const productId = await seedProduct({ companyId, barcode: '790' });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);

    const { status, body } = await request(baseUrl, 'PATCH', `/api/products/${productId}/restore`, managerToken);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: productId, isActive: true });
  });

  it('PATCH /products/:id/restore é só para gerente (403 para funcionário)', async () => {
    const productId = await seedProduct({ companyId, barcode: '791' });

    const { status } = await request(baseUrl, 'PATCH', `/api/products/${productId}/restore`, employeeToken);

    expect(status).toBe(403);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx jest src/modules/products/products.service.spec.ts
npm run test:int -- src/modules/products/products-lifecycle.int-spec.ts src/modules/products/products.http.int-spec.ts
```
Expected: unitário FAIL — `restore is not a function` (3 testes); integração: o arquivo de ciclo de vida
falha na compilação (`Property 'restore' does not exist`), e o HTTP falha nos 2 testes novos com **404**
(rota inexistente). O teste "findByBarcode não devolve arquivado" também falharia sozinho (hoje devolve).

- [ ] **Step 3: Implementar**

Modify `backend/src/modules/products/products.service.ts`:

Em `findByBarcode`, trocar `const product = await manager.findOne(Product, { where: { barcode } });` por:
```ts
    // Só ativos (F11): o app não pode registrar perda num produto arquivado.
    const product = await manager.findOne(Product, { where: { barcode, isActive: true } });
```

Novo método, antes de `remove`:
```ts
  /** Reativa um produto arquivado (F2). Idempotente: reativar um produto ativo só o devolve. */
  async restore(id: string): Promise<Product> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }
    if (product.isActive) return product;
    product.isActive = true;
    return manager.save(product);
  }
```

Modify `backend/src/modules/products/products.controller.ts` — depois do `update` (`@Patch(':id')`):
```ts
  // Reativa um produto arquivado (o "Excluir" do painel arquiva — ver remove()).
  @Patch(':id/restore')
  @Roles(UserRole.MANAGER)
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.restore(id);
  }
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx jest src/modules/products/products.service.spec.ts
npm run test:int -- src/modules/products/products-lifecycle.int-spec.ts src/modules/products/products.http.int-spec.ts
```
Expected: PASS — unitário 8; integração 4 + 3.

- [ ] **Step 5: Checagem e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/products/products.service.ts src/modules/products/products.controller.ts src/modules/products/products.service.spec.ts src/modules/products/products-lifecycle.int-spec.ts src/modules/products/products.http.int-spec.ts
git commit -m "feat(backend): reativar produto arquivado; busca por código de barras só com ativos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 19/126; 14/56; `tsc exit=0`.

---

### Task 3: `GET /products/search` — busca paginada no servidor

**Files:**
- Create: `backend/src/modules/products/products-search.ts`
- Create: `backend/src/modules/products/dto/search-products.dto.ts`
- Create: `backend/src/modules/products/products-search.spec.ts`
- Create: `backend/src/modules/products/products-search.int-spec.ts`
- Modify: `backend/src/modules/products/products.service.ts`, `products.controller.ts`
- Modify: `backend/src/modules/products/products.http.int-spec.ts`

**Interfaces:**
- Consumes: harness HTTP da Task 1.
- Produces: `escapeLikePattern(text: string): string`, `DEFAULT_PAGE_SIZE = 20`, `MAX_PAGE_SIZE = 100`,
  `interface ProductSearchResult { items: Product[]; total: number; page: number; pageSize: number }`
  (`products-search.ts`); `class SearchProductsDto { q?; status?: 'active' | 'archived' | 'all'; page?;
  pageSize?; sort?: 'name' | 'updatedAt' }`; `ProductsService.search(dto: SearchProductsDto):
  Promise<ProductSearchResult>`. A sub-etapa 1.3.2 (web) consome o formato `{ items, total, page, pageSize }`.

**Decisões deste plano:**
- "prefixo do código de barras e SKU" (spec 5.1) = **prefixo** para os dois códigos (código de barras com
  `LIKE`, SKU com `ILIKE`); nome por **conteúdo** (`ILIKE '%…%'`).
- Ordenação `name` = `name ASC, id ASC`; `updatedAt` = `updatedAt DESC, id ASC` (mais recente primeiro — o
  uso é "o que mudou por último"). O desempate por `id` evita item pulado/repetido entre páginas.
- "Montagem de filtros" (spec 5.3, unitário) é coberta por testes puros de `escapeLikePattern` e do DTO;
  o efeito dos filtros é provado em integração (Postgres real), onde `ILIKE`/`ESCAPE` têm significado.

- [ ] **Step 1: Testes unitários (vão falhar)**

Create `backend/src/modules/products/products-search.spec.ts`:

```ts
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
    [{ status: 'deleted' }, 'status'],
    [{ sort: 'price' }, 'sort'],
    [{ q: 'x'.repeat(101) }, 'q'],
  ])('rejeita %o no campo %s', async (query, field) => {
    const { errors } = await errorsFor(query as Record<string, string>);
    expect(errors.map((e) => e.property)).toContain(field);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/products/products-search.spec.ts`
Expected: FAIL — `Cannot find module './dto/search-products.dto'`.

- [ ] **Step 3: Implementar os módulos puros**

Create `backend/src/modules/products/products-search.ts`:

```ts
import { Product } from './product.entity';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface ProductSearchResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Escapa os curingas do LIKE (%, _) e a própria barra invertida, para o texto digitado ser procurado
 * literalmente — "100%" procura "100%", não "tudo que começa com 100". Usar com `ESCAPE '\'`.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
```

Create `backend/src/modules/products/dto/search-products.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../products-search';

export const PRODUCT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

export const PRODUCT_SORTS = ['name', 'updatedAt'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Query de GET /products/search (spec do SP1, seção 5.1). Tudo opcional; padrões no serviço. */
export class SearchProductsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUS_FILTERS)
  status?: ProductStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/products/products-search.spec.ts`
Expected: PASS — 10 testes (2 + 1 + 7).

- [ ] **Step 5: Testes de integração da busca e HTTP (vão falhar)**

Create `backend/src/modules/products/products-search.int-spec.ts`:

```ts
import { adminQuery, closeTestConnections, seedCompany, seedProduct, truncateAll, withTenant } from '../../test-utils/test-db';
import { SearchProductsDto } from './dto/search-products.dto';
import { ProductsService } from './products.service';

function search(companyId: string, query: SearchProductsDto) {
  return withTenant({ companyId }, () => new ProductsService().search(query));
}

function names(result: { items: { name: string }[] }): string[] {
  return result.items.map((item) => item.name);
}

describe('ProductsService.search (Postgres real)', () => {
  let companyId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Busca');
  });
  afterAll(() => closeTestConnections());

  it('nome por conteúdo, sem diferenciar maiúsculas', async () => {
    await seedProduct({ companyId, barcode: '7891', name: 'Arroz 5kg' });
    await seedProduct({ companyId, barcode: '7892', name: 'Feijão Arroz-doce' });
    await seedProduct({ companyId, barcode: '5550', name: 'Feijão' });

    expect(names(await search(companyId, { q: 'ARROZ' })).sort()).toEqual(['Arroz 5kg', 'Feijão Arroz-doce']);
  });

  it('código de barras por PREFIXO (não por conteúdo)', async () => {
    await seedProduct({ companyId, barcode: '7891000', name: 'Produto A' });
    await seedProduct({ companyId, barcode: '1117891', name: 'Produto B' });

    expect(names(await search(companyId, { q: '789' }))).toEqual(['Produto A']);
  });

  it('SKU por prefixo, sem diferenciar maiúsculas', async () => {
    const id = await seedProduct({ companyId, barcode: '1', name: 'Com SKU' });
    await adminQuery(`UPDATE products SET sku = 'ABC-123' WHERE id = $1`, [id]);
    await seedProduct({ companyId, barcode: '2', name: 'Sem SKU' });

    expect(names(await search(companyId, { q: 'abc' }))).toEqual(['Com SKU']);
  });

  it('"%" é procurado literalmente — não vira "tudo"', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Suco 100% uva' });
    await seedProduct({ companyId, barcode: '2', name: 'Suco de maçã' });

    expect(names(await search(companyId, { q: '100%' }))).toEqual(['Suco 100% uva']);
    expect(names(await search(companyId, { q: '%' }))).toEqual(['Suco 100% uva']);
  });

  it('"_" é procurado literalmente — não vira "qualquer caractere"', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'caixa_a' });
    await seedProduct({ companyId, barcode: '2', name: 'caixa-a' });

    expect(names(await search(companyId, { q: 'caixa_a' }))).toEqual(['caixa_a']);
  });

  it('barra invertida é procurada literalmente', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'pasta\\x' });
    await seedProduct({ companyId, barcode: '2', name: 'pastax' });

    expect(names(await search(companyId, { q: '\\x' }))).toEqual(['pasta\\x']);
  });

  it('status: padrão só ativos; "archived" só arquivados; "all" os dois', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Ativo' });
    const archivedId = await seedProduct({ companyId, barcode: '2', name: 'Arquivado' });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [archivedId]);

    expect(names(await search(companyId, {}))).toEqual(['Ativo']);
    expect(names(await search(companyId, { status: 'archived' }))).toEqual(['Arquivado']);
    expect(names(await search(companyId, { status: 'all' }))).toEqual(['Arquivado', 'Ativo']);
  });

  it('paginação: total de TODOS os resultados e fatia da página, ordenada por nome', async () => {
    for (let i = 1; i <= 25; i += 1) {
      await seedProduct({ companyId, barcode: `${1000 + i}`, name: `Produto ${String(i).padStart(2, '0')}` });
    }

    const page3 = await search(companyId, { page: 3, pageSize: 10 });

    expect(page3.total).toBe(25);
    expect(page3.page).toBe(3);
    expect(page3.pageSize).toBe(10);
    expect(names(page3)).toEqual(['Produto 21', 'Produto 22', 'Produto 23', 'Produto 24', 'Produto 25']);
  });

  it('sem page/pageSize: página 1 com 20 itens', async () => {
    for (let i = 1; i <= 21; i += 1) {
      await seedProduct({ companyId, barcode: `${2000 + i}`, name: `Item ${String(i).padStart(2, '0')}` });
    }

    const result = await search(companyId, {});

    expect(result).toMatchObject({ total: 21, page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(20);
  });

  it('sort=updatedAt: o alterado por último vem primeiro', async () => {
    await seedProduct({ companyId, barcode: '1', name: 'Antigo' });
    const recentId = await seedProduct({ companyId, barcode: '2', name: 'Recente' });
    await adminQuery(`UPDATE products SET "updatedAt" = now() + interval '1 minute' WHERE id = $1`, [recentId]);

    expect(names(await search(companyId, { sort: 'updatedAt' }))).toEqual(['Recente', 'Antigo']);
  });

  it('RLS: produtos de outra empresa não aparecem nem contam no total', async () => {
    const other = await seedCompany('Outra Empresa Busca');
    await seedProduct({ companyId, barcode: '1', name: 'Meu' });
    await seedProduct({ companyId: other, barcode: '2', name: 'Dela' });

    const result = await search(companyId, { status: 'all' });

    expect(result.total).toBe(1);
    expect(names(result)).toEqual(['Meu']);
  });
});
```

Modify `backend/src/modules/products/products.http.int-spec.ts` — dentro do `describe`, ao fim:

```ts
  it('GET /products/search responde a busca (a rota estática não cai em handler paramétrico)', async () => {
    await seedProduct({ companyId, barcode: '800', name: 'Arroz' });

    const { status, body } = await request(baseUrl, 'GET', '/api/products/search?q=arr&pageSize=5', managerToken);

    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 5 });
    expect(body.items[0]).toMatchObject({ name: 'Arroz', barcode: '800' });
  });

  it.each(['pageSize=500', 'page=0', 'page=abc', 'status=deleted', 'foo=bar'])(
    'GET /products/search?%s ⇒ 400 (validação da query)',
    async (query) => {
      const { status } = await request(baseUrl, 'GET', `/api/products/search?${query}`, managerToken);
      expect(status).toBe(400);
    },
  );

  it('GET /products/search é só para gerente (403 para funcionário)', async () => {
    const { status } = await request(baseUrl, 'GET', '/api/products/search', employeeToken);
    expect(status).toBe(403);
  });
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/products/products-search.int-spec.ts src/modules/products/products.http.int-spec.ts`
Expected: `products-search.int-spec.ts` falha na compilação (`Property 'search' does not exist`); no HTTP, os
testes de `search` falham (hoje `GET /api/products/search` não existe: 404).

- [ ] **Step 7: Implementar o serviço e a rota**

Modify `backend/src/modules/products/products.service.ts`:
- imports: `import { Brackets } from 'typeorm';`, `import { SearchProductsDto } from './dto/search-products.dto';`,
  `import { DEFAULT_PAGE_SIZE, escapeLikePattern, ProductSearchResult } from './products-search';`
- novo método, logo depois de `findAll`:

```ts
  /**
   * Busca paginada no servidor para o painel (F10): nome por conteúdo, código de barras e SKU por prefixo,
   * com os curingas do texto escapados. O `GET /products` (sync do app) continua separado e inalterado.
   */
  async search(dto: SearchProductsDto): Promise<ProductSearchResult> {
    const manager = getTenantManager();
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = dto.status ?? 'active';

    const qb = manager.createQueryBuilder(Product, 'product');
    if (status !== 'all') {
      qb.andWhere('product.isActive = :isActive', { isActive: status === 'active' });
    }

    const term = dto.q?.trim();
    if (term) {
      const escaped = escapeLikePattern(term);
      qb.andWhere(
        new Brackets((where) => {
          where
            .where(`product.name ILIKE :contains ESCAPE '\\'`, { contains: `%${escaped}%` })
            .orWhere(`product.barcode LIKE :prefix ESCAPE '\\'`, { prefix: `${escaped}%` })
            .orWhere(`product.sku ILIKE :prefix ESCAPE '\\'`, { prefix: `${escaped}%` });
        }),
      );
    }

    if (dto.sort === 'updatedAt') {
      qb.orderBy('product.updatedAt', 'DESC');
    } else {
      qb.orderBy('product.name', 'ASC');
    }
    // Desempate estável: sem ele, itens com o mesmo nome/data podem pular ou repetir entre páginas.
    qb.addOrderBy('product.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }
```

Modify `backend/src/modules/products/products.controller.ts`:
- import: `import { SearchProductsDto } from './dto/search-products.dto';`
- nova rota **antes** de `findByBarcode` (e de qualquer rota com parâmetro):

```ts
  // Busca paginada do painel (etapa 1.3). Rota estática declarada antes das paramétricas.
  @Get('search')
  @Roles(UserRole.MANAGER)
  search(@Query() query: SearchProductsDto) {
    return this.productsService.search(query);
  }
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npm run test:int -- src/modules/products/products-search.int-spec.ts src/modules/products/products.http.int-spec.ts`
Expected: PASS — busca 11; HTTP 3 + 1 + 5 + 1 = 10.

- [ ] **Step 9: Checagem e commit**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/products/products-search.ts src/modules/products/dto/search-products.dto.ts src/modules/products/products-search.spec.ts src/modules/products/products-search.int-spec.ts src/modules/products/products.service.ts src/modules/products/products.controller.ts src/modules/products/products.http.int-spec.ts
git commit -m "feat(backend): GET /products/search com paginação e escape de curingas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 20/136; 15/74; `tsc exit=0`.

---

### Task 4: Importação reativa produto arquivado

**Files:**
- Modify: `backend/src/modules/imports/imports.processor.ts` (bloco `if (existing) { … }`)
- Test: `backend/src/modules/imports/imports.processor.int-spec.ts`

**Interfaces:**
- Consumes: nada das tarefas anteriores.
- Produces: nada consumido depois.

- [ ] **Step 1: Teste (vai falhar)**

Modify `backend/src/modules/imports/imports.processor.int-spec.ts` — dentro do `describe` existente, ao fim:

```ts
  it('produto ARQUIVADO que volta na planilha é reativado, e a mudança de preço fica com source = import', async () => {
    const companyId = await seedCompany('Empresa Reativação');
    const productId = await seedProduct({ companyId, barcode: '8101', unitPrice: 10 });
    await adminQuery(`UPDATE products SET "isActive" = false WHERE id = $1`, [productId]);
    const importJobId = (
      await adminQuery(
        `INSERT INTO import_jobs ("companyId", "fileName", "storageKey") VALUES ($1, 'p.xlsx', 'k') RETURNING id`,
        [companyId],
      )
    )[0].id;
    const buffer = await spreadsheet([['8101', 'Voltou ao catálogo', 12]]);
    const storage = { downloadBuffer: async () => buffer } as unknown as StorageService;

    await new ImportsProcessor(await appDataSource(), storage).process({
      data: {
        importJobId,
        companyId,
        storageKey: 'k',
        mapping: { barcodeColumn: 'Codigo', nameColumn: 'Nome', unitPriceColumn: 'Preco' },
      },
    } as Job<ProductImportJobData>);

    const [product] = await adminQuery(`SELECT "isActive", name FROM products WHERE id = $1`, [productId]);
    expect(product).toEqual({ isActive: true, name: 'Voltou ao catálogo' });
    const history = await adminQuery(
      `SELECT "unitPrice", source FROM product_price_history WHERE "productId" = $1 ORDER BY seq DESC LIMIT 1`,
      [productId],
    );
    expect(history[0]).toMatchObject({ unitPrice: '12.00', source: 'import' });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- src/modules/imports/imports.processor.int-spec.ts`
Expected: FAIL no teste novo — `isActive: false` (o upsert atual não reativa).

- [ ] **Step 3: Implementar**

Modify `backend/src/modules/imports/imports.processor.ts` — no bloco `if (existing) {`, depois de
`existing.unitPrice = unitPrice;`:
```ts
              // Produto arquivado que volta na planilha do ERP volta ao catálogo (F2/F9c). O relatório
              // de "reativados" da importação fica para o SP3.
              existing.isActive = true;
```

- [ ] **Step 4: Rodar, checar e commit**

```bash
npm run test:int -- src/modules/imports/imports.processor.int-spec.ts
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
git add src/modules/imports/imports.processor.ts src/modules/imports/imports.processor.int-spec.ts
git commit -m "feat(backend): importação reativa produto arquivado que volta na planilha" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: PASS (2 testes no arquivo); 20/136; 15/75; `tsc exit=0`.

---

### Task 5: Medição com 100 mil produtos e registro do andamento

**Files:**
- Temporário (NÃO commitar): `backend/src/modules/products/products-search.perf.int-spec.ts`
- Modify: `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` (seção 5)
- Modify: `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` (seção 10)

**Interfaces:** nenhuma.

- [ ] **Step 1: Medir (spec 5.3 — "não vira teste permanente")**

Create `backend/src/modules/products/products-search.perf.int-spec.ts`:

```ts
import { adminQuery, closeTestConnections, seedCompany, truncateAll, withTenant } from '../../test-utils/test-db';
import { ProductsService } from './products.service';

// Medição única (spec do SP1, 5.3): NÃO commitar. Critério: se passar de ~300 ms, pg_trgm vira a decisão D6.
describe('medição: search com 100 mil produtos', () => {
  afterAll(async () => {
    await truncateAll();
    await closeTestConnections();
  });

  it('mede', async () => {
    await truncateAll();
    const companyId = await seedCompany('Empresa Grande');
    await adminQuery(
      `INSERT INTO products ("companyId", barcode, name, sku, "unitPrice", "costPrice")
       SELECT $1, lpad(n::text, 13, '789'), 'Produto ' || n || ' ' || md5(n::text), 'SKU-' || n, 10, 5
         FROM generate_series(1, 100000) AS n`,
      [companyId],
    );
    await adminQuery('ANALYZE products');

    const cases: Record<string, object> = {
      'sem q, página 1': {},
      'sem q, página 2500': { page: 2500, pageSize: 40 },
      'q por nome (conteúdo)': { q: 'a1b2' },
      'q por código (prefixo)': { q: '789000001' },
      'q sem resultado': { q: 'zzzz-nada' },
      'status=all, sort=updatedAt': { status: 'all', sort: 'updatedAt' },
    };
    for (const [label, query] of Object.entries(cases)) {
      const timings: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const start = process.hrtime.bigint();
        await withTenant({ companyId }, () => new ProductsService().search(query));
        timings.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      // eslint-disable-next-line no-console
      console.log(`${label}: ${timings.map((t) => t.toFixed(0)).join(' / ')} ms`);
    }
  }, 300000);
});
```

Run: `npx jest --config jest.integration.config.js src/modules/products/products-search.perf.int-spec.ts 2>&1 | grep " ms"`
(o seed de 100 mil linhas também dispara o trigger do histórico de preço — é esperado e demora; a
medição é das buscas). Anotar os tempos (a 2ª e a 3ª execução de cada caso contam; a 1ª aquece).

Depois: `rm src/modules/products/products-search.perf.int-spec.ts` e confirmar com `git status --short`
que ele não aparece.

**Critério:** todos os casos ≤ ~300 ms ⇒ sem `pg_trgm` (R7 mantido). Algum caso > 300 ms ⇒ **parar e
apresentar a decisão D6 ao usuário** (índice `pg_trgm` para `ILIKE`, com os números), antes de fechar a
etapa.

- [ ] **Step 2: Registrar o andamento**

Modify `docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md` — no fim da seção 5.3 (antes
de `**Pronto quando:**` da seção 5):

```markdown
**Divisão da etapa (2026-09-23):** 1.3.1 = backend (contratos 5.1, testes de backend de 5.3); 1.3.2 =
web (5.2, testes web de 5.3). **Resultado da 1.3.1 (<data>):** `errorCode` no 409 do cadastro (inclusive
no cadastro concorrente que viola o índice único), `PATCH /products/:id/restore` (idempotente),
`GET /products/search` (nome por conteúdo; código de barras e SKU por prefixo; `%`/`_`/`\` literais;
`sort=updatedAt` = mais recente primeiro; desempate por `id`), `findByBarcode` só ativos, importação
reativa arquivado. Contratos HTTP testados numa app Nest real (`products.http.int-spec.ts`). Medição com
100 mil produtos: <tempos> ⇒ <decisão sobre pg_trgm>.
```

Modify `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md` — na linha do SP1 (seção 10):
acrescentar ao status `Etapa 1.3 dividida em 1.3.1 (backend) e 1.3.2 (web); 1.3.1 concluída em <data>
(branch feat/cadastros-sp1-etapa-1-3-1).`; à coluna Plano `1.3.1:
[plano](../plans/2026-09-23-sp1-etapa-1-3-1-ciclo-de-vida-e-busca-backend.md) (executado).`; baselines
de backend para os números finais.

- [ ] **Step 3: Checagem final e commit**

```bash
cd /c/PROJETOS/SAAS/backend
npm test 2>&1 | grep -E "^Tests:|^Test Suites:"
npm run test:int 2>&1 | grep -E "^Tests:|^Test Suites:"
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
cd /c/PROJETOS/SAAS && git status --short
git add docs/superpowers/specs/2026-09-20-sp1-fundacao-de-dados-design.md docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md
git commit -m "docs: andamento do SP1 — sub-etapa 1.3.1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 20/136; 15/75; `tsc exit=0`; `git status` sem o arquivo de medição.

---

## Auto-revisão

**Cobertura do spec (5.1 e parte backend de 5.3):** 409 com `errorCode`/`productId` → Task 1;
`restore` → Task 2; `DELETE` inalterado (não tocado); `search` com todos os parâmetros, padrões, máximo,
escape → Task 3; `findByBarcode` só ativos → Task 2; `GET /products` inalterado (não tocado); `PATCH`
permitido para arquivados (não tocado — `update` não filtra `isActive`); rota estática antes das
paramétricas → Task 3 (+ teste HTTP); importação reativa → Task 4 (o teste de `source='import'` pedido
em 5.3 já existia desde a 1.2.3 e ganha o caso do arquivado). Testes unitários de 5.3: create (Task 1),
restore e findByBarcode (Task 2; findByBarcode em integração, onde o filtro tem efeito), filtros do search
(Task 3, pelas funções puras + DTO). Integração de 5.3: escape, paginação/total, status, restore
idempotente, RLS → Tasks 2 e 3. Medição de 100 mil → Task 5.

**Review Focus:** 1 → Task 3 (3 testes de escape); 2 → Task 3 (DTO + HTTP 400); 3 → Task 3 (HTTP da rota
`search`); 4 → Task 2 (integração RLS); 5 → Task 1 (unitário `23505`).

**Placeholders:** `<data>`, `<tempos>`, `<decisão sobre pg_trgm>` na Task 5 são preenchidos com os valores
medidos na execução.

**Consistência:** `barcodeConflict`/`isBarcodeUniqueViolation`/`ProductErrorCode` (Task 1),
`restore` (Task 2), `escapeLikePattern`/`DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE`/`ProductSearchResult`/
`SearchProductsDto`/`search` (Task 3) — nomes e assinaturas iguais onde reaparecem. Os helpers HTTP da
Task 1 (`startApp`, `request`, `tokenFor`, `seedUser`) são reutilizados nas Tasks 2 e 3 no mesmo arquivo.

# Preço de custo do produto (`costPrice`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar preço de custo ao cadastro de produto e mostrar "prejuízo de custo" (o write-off real) ao lado de "receita perdida" (o cálculo atual) nos relatórios e no dashboard.

**Architecture:** Uma coluna nova em `products` (`costPrice`, mesmo padrão de `unitPrice`), propagada pelos DTOs/service do backend, pelos relatórios de perdas (`reportByProduct`, `reportSummary`), e exposta no formulário de produto e no dashboard do web-panel. O app mobile não muda.

**Tech Stack:** NestJS + TypeORM + PostgreSQL (backend), Next.js + React + shadcn/ui (web-panel), Jest (testes backend).

**Spec:** `docs/superpowers/specs/2026-09-12-dashboard-loss-prevention-features-design.md` (seção 1).

## Global Constraints

- Todo dinheiro é `numeric(12,2)` no banco e `number` no TypeScript, igual a `unitPrice`.
- Migrations rodam a partir do HOST (não de dentro do container Docker) — o container roda só o `dist/` compilado, sem `ts-node`/`src`. Comando: dentro de `backend/`, `npm run migration:run` (usa `backend/.env`, que aponta pro Postgres publicado em `localhost:5432` com o usuário admin).
- Depois de migrar, o container `backend` precisa ser reconstruído (`docker compose up -d --build backend`) pra rodar o código novo.
- Testes backend: `npx jest <arquivo>` a partir de `backend/`.
- Web-panel não tem suíte de testes automatizada — verificação é manual, via Browser pane, com o dev server (`preview_start` com a config `web-panel` de `.claude/launch.json`).

---

### Task 1: Migration + entity — coluna `costPrice`

**Files:**
- Create: `backend/src/database/migrations/1700000007000-ProductCostPrice.ts`
- Modify: `backend/src/modules/products/product.entity.ts`

**Interfaces:**
- Produces: coluna `products.costPrice` (numeric(12,2), not null, default 0), e `Product.costPrice: number` na entity — usado pelas Tasks 2 e 3.

- [ ] **Step 1: Criar a migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

// Preço de custo do produto (o que a empresa pagou) — usado para calcular o
// "prejuízo de custo" nos relatórios, separado da "receita perdida" (que já
// usa unitPrice). Produtos existentes ficam com costPrice = 0 até o gerente
// preencher (não há como inferir o custo retroativamente).
export class ProductCostPrice1700000007000 implements MigrationInterface {
  name = 'ProductCostPrice1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN "costPrice" numeric(12,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "costPrice"`);
  }
}
```

- [ ] **Step 2: Atualizar a entity**

Em `backend/src/modules/products/product.entity.ts`, logo depois do campo `unitPrice`:

```typescript
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  unitPrice: number;

  // Preço de custo (o que a empresa pagou) — separado de unitPrice (preço de
  // venda) para calcular o prejuízo de custo real nos relatórios.
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  costPrice: number;
```

- [ ] **Step 3: Rodar a migration**

A partir de `backend/`:

```bash
npm run migration:run
```

Esperado: log confirmando `ProductCostPrice1700000007000` executada com sucesso.

- [ ] **Step 4: Confirmar a coluna no banco**

```bash
docker compose exec -T postgres psql -U postgres -d inventory_saas -c "\d products" | grep costPrice
```

Esperado: uma linha mostrando `costPrice | numeric(12,2)`.

- [ ] **Step 5: Reconstruir o container do backend**

```bash
docker compose up -d --build backend
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/database/migrations/1700000007000-ProductCostPrice.ts backend/src/modules/products/product.entity.ts
git commit -m "feat(backend): adiciona coluna costPrice em products"
```

(Se o projeto ainda não for um repositório git, pule este passo e avise no relatório final.)

---

### Task 2: `ProductsService` grava `costPrice` no create/update

**Files:**
- Modify: `backend/src/modules/products/dto/create-product.dto.ts`
- Modify: `backend/src/modules/products/dto/update-product.dto.ts`
- Modify: `backend/src/modules/products/products.service.ts`
- Test: `backend/src/modules/products/products.service.spec.ts` (novo arquivo)

**Interfaces:**
- Consumes: `Product` entity com `costPrice` (Task 1).
- Produces: `CreateProductDto.costPrice?: number`, `UpdateProductDto.costPrice?: number` — usados pelos controllers (sem mudança de assinatura) e pelo formulário do web-panel (Task 4).

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/products/products.service.spec.ts`:

```typescript
import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from '../users/user.entity';
import { ProductsService } from './products.service';

const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
}

describe('ProductsService — costPrice', () => {
  it('grava costPrice ao criar um produto', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'prod-1', ...data })),
    };
    const service = new ProductsService();

    const result = await runWithTenantContext(manager, () =>
      service.create({ barcode: '123', name: 'Arroz 5kg', unitPrice: 24.9, costPrice: 18.5 }),
    );

    expect(result).toMatchObject({ costPrice: 18.5 });
  });

  it('atualiza costPrice quando informado', async () => {
    const existing = { id: 'prod-1', barcode: '123', name: 'Arroz 5kg', unitPrice: 24.9, costPrice: 18.5 };
    const manager = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };
    const service = new ProductsService();

    const result = await runWithTenantContext(manager, () => service.update('prod-1', { costPrice: 20 }));

    expect(result).toMatchObject({ costPrice: 20 });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

A partir de `backend/`:

```bash
npx jest src/modules/products/products.service.spec.ts
```

Esperado: FALHA — `costPrice` não é aceito pelo DTO / não é gravado (o objeto retornado não vai ter `costPrice`, ou o TypeScript vai reclamar de propriedade inexistente no DTO).

- [ ] **Step 3: Atualizar os DTOs**

Em `backend/src/modules/products/dto/create-product.dto.ts`, adicionar depois de `unitPrice`:

```typescript
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;
```

Em `backend/src/modules/products/dto/update-product.dto.ts`, o mesmo bloco (campo opcional, mesmas validações).

- [ ] **Step 4: Atualizar `ProductsService`**

Em `backend/src/modules/products/products.service.ts`, dentro de `create()`:

```typescript
    const product = manager.create(Product, {
      companyId: companyId!,
      barcode: dto.barcode,
      sku: dto.sku ?? null,
      name: dto.name,
      unitPrice: dto.unitPrice ?? 0,
      costPrice: dto.costPrice ?? 0,
    });
```

E dentro de `update()`, logo depois do bloco `if (dto.unitPrice !== undefined) product.unitPrice = dto.unitPrice;`:

```typescript
    if (dto.unitPrice !== undefined) product.unitPrice = dto.unitPrice;
    if (dto.costPrice !== undefined) product.costPrice = dto.costPrice;
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/products/products.service.spec.ts
```

Esperado: PASS, 2 testes.

- [ ] **Step 6: Rodar a suíte completa do backend**

```bash
npx jest
```

Esperado: todos os testes passando (nenhuma regressão).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/products/dto/create-product.dto.ts backend/src/modules/products/dto/update-product.dto.ts backend/src/modules/products/products.service.ts backend/src/modules/products/products.service.spec.ts
git commit -m "feat(backend): ProductsService grava costPrice"
```

---

### Task 3: `LossesService` — prejuízo de custo nos relatórios

**Files:**
- Modify: `backend/src/modules/losses/losses.service.ts`

**Interfaces:**
- Consumes: `Product.costPrice` (Task 1).
- Produces: `reportByProduct()` cada linha ganha `totalCostLoss: string`; `reportSummary()` cada período (`currentMonth`/`previousMonth`) ganha `totalCostLoss: number`, e a resposta ganha `costVariationPercent: number | null` — consumidos pelo dashboard do web-panel (Task 5).

> Nota: os métodos de relatório usam `createQueryBuilder` com agregação SQL
> (`SUM`), e a suíte de testes deste projeto não mocka QueryBuilder (só
> `findOne`/`create`/`save`/`delete` — ver os specs existentes). Seguindo o
> mesmo padrão já usado neste arquivo, a verificação deste task é uma checagem
> de integração real contra o Postgres rodando, não um teste unitário
> mockado — um mock de QueryBuilder aqui testaria "o método X foi chamado",
> não se a soma está certa de verdade.

- [ ] **Step 1: Atualizar `reportByProduct`**

Em `backend/src/modules/losses/losses.service.ts`, dentro de `reportByProduct`, logo depois de `.addSelect('SUM(loss.quantity * product.unitPrice)', 'totalFinancialLoss')`:

```typescript
      .addSelect('SUM(loss.quantity * product.unitPrice)', 'totalFinancialLoss')
      .addSelect('SUM(loss.quantity * product.costPrice)', 'totalCostLoss')
```

- [ ] **Step 2: Atualizar `sumRange` (usado por `reportSummary`)**

```typescript
  private async sumRange(from: Date, to: Date) {
    const manager = getTenantManager();
    const raw = await manager
      .createQueryBuilder(Loss, 'loss')
      .innerJoin(Product, 'product', 'product.id = loss.productId')
      .select('COALESCE(SUM(loss.quantity), 0)', 'totalQuantity')
      .addSelect('COALESCE(SUM(loss.quantity * product.unitPrice), 0)', 'totalFinancialLoss')
      .addSelect('COALESCE(SUM(loss.quantity * product.costPrice), 0)', 'totalCostLoss')
      .where('loss.occurredAt >= :from AND loss.occurredAt < :to', { from, to })
      .getRawOne<{ totalQuantity: string; totalFinancialLoss: string; totalCostLoss: string }>();
    return {
      totalQuantity: Number(raw?.totalQuantity ?? 0),
      totalFinancialLoss: Number(raw?.totalFinancialLoss ?? 0),
      totalCostLoss: Number(raw?.totalCostLoss ?? 0),
    };
  }
```

- [ ] **Step 3: Atualizar `reportSummary`**

```typescript
  async reportSummary() {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const currentMonth = await this.sumRange(startOfCurrentMonth, now);
    const previousMonth = await this.sumRange(startOfPreviousMonth, startOfCurrentMonth);

    const financialVariationPercent =
      previousMonth.totalFinancialLoss === 0
        ? null
        : ((currentMonth.totalFinancialLoss - previousMonth.totalFinancialLoss) /
            previousMonth.totalFinancialLoss) *
          100;

    const costVariationPercent =
      previousMonth.totalCostLoss === 0
        ? null
        : ((currentMonth.totalCostLoss - previousMonth.totalCostLoss) / previousMonth.totalCostLoss) * 100;

    return { currentMonth, previousMonth, financialVariationPercent, costVariationPercent };
  }
```

- [ ] **Step 4: Reconstruir e subir o backend**

A partir de `backend/`:

```bash
docker compose up -d --build backend
```

- [ ] **Step 5: Verificação de integração — preparar dado de teste**

Executar em sequência (Bash), a partir de qualquer diretório, com o backend rodando em `localhost:3000`:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gerente.teste.mobilerun@exemplo.com","password":"senha123"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
echo "token len: ${#TOKEN}"   # deve ser > 0

PRODUCT_ID=$(curl -s -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"barcode":"COSTTEST1","name":"Produto Teste Custo","unitPrice":100,"costPrice":60}' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
echo "PRODUCT_ID=$PRODUCT_ID"
```

- [ ] **Step 6: Garantir um motivo e um local cadastrados, e registrar a perda**

```bash
REASON_ID=$(curl -s -X POST http://localhost:3000/api/loss-reasons \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Teste costPrice"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

LOCATION_ID=$(curl -s -X POST http://localhost:3000/api/loss-locations \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Teste costPrice"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo "REASON_ID=$REASON_ID LOCATION_ID=$LOCATION_ID"

# Quantidade 3: prejuízo de venda esperado = 300 (3 x unitPrice 100),
# prejuízo de custo esperado = 180 (3 x costPrice 60).
curl -s -X POST http://localhost:3000/api/losses \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{
    "clientGeneratedId":"11111111-1111-1111-1111-111111111111",
    "productId":"'"$PRODUCT_ID"'",
    "reasonId":"'"$REASON_ID"'",
    "locationId":"'"$LOCATION_ID"'",
    "quantity":3,
    "occurredAt":"2026-09-12T12:00:00.000Z"
  }' -w "\nHTTP_STATUS:%{http_code}\n"
```

Esperado: `HTTP_STATUS:201` (ou `200`) e o corpo da resposta sem campo `message`/`error`.

- [ ] **Step 7: Verificar o relatório**

```bash
curl -s "http://localhost:3000/api/losses/reports/by-product" -H "Authorization: Bearer $TOKEN" | grep -A2 COSTTEST1
curl -s "http://localhost:3000/api/losses/reports/summary" -H "Authorization: Bearer $TOKEN"
```

Esperado: a linha do "Produto Teste Custo" em `by-product` tem `totalCostLoss` proporcional a 180 (3 × 60) e `totalFinancialLoss` proporcional a 300 (3 × 100); `summary` inclui `totalCostLoss` e `costVariationPercent` em `currentMonth`.

- [ ] **Step 8: Rodar a suíte de testes do backend (regressão)**

A partir de `backend/`:

```bash
npx jest
```

Esperado: todos os testes passando.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/losses/losses.service.ts
git commit -m "feat(backend): prejuizo de custo em reportByProduct e reportSummary"
```

---

### Task 4: Web-panel — campo de preço de custo no cadastro de produto

**Files:**
- Modify: `web-panel/src/lib/types.ts`
- Modify: `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`

**Interfaces:**
- Consumes: `POST /products` e `PATCH /products/:id` aceitando `costPrice` (Task 2).
- Produces: nenhuma interface nova consumida por outro task — mudança de UI isolada.

- [ ] **Step 1: Atualizar os tipos**

Em `web-panel/src/lib/types.ts`:

```typescript
export interface Product {
  id: string;
  barcode: string;
  sku: string | null;
  name: string;
  unitPrice: string | number;
  costPrice: string | number;
  isActive: boolean;
}

export interface UpdateProductInput {
  barcode?: string;
  sku?: string;
  name?: string;
  unitPrice?: number;
  costPrice?: number;
}
```

- [ ] **Step 2: Adicionar o campo no formulário de cadastro**

Em `web-panel/src/app/(protected)/cadastros/produtos/page.tsx`, adicionar o state (perto de `unitPrice`):

```typescript
  const [unitPrice, setUnitPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
```

No `handleSubmit`, incluir no payload:

```typescript
      await api.post('products', {
        barcode,
        name,
        unitPrice: unitPrice ? Number(unitPrice) : undefined,
        costPrice: costPrice ? Number(costPrice) : undefined,
      });
      setBarcode('');
      setName('');
      setUnitPrice('');
      setCostPrice('');
```

No JSX do formulário de cadastro, logo depois do campo "Preço unitário (R$)" (mudar o grid de `sm:grid-cols-3` para `sm:grid-cols-4` pra caber o campo novo):

```tsx
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Código de barras</Label>
              <Input required value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Preço unitário (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Preço de custo (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
              />
            </div>

            {formError && <p className="text-sm text-destructive sm:col-span-4">{formError}</p>}

            <div className="sm:col-span-4">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Cadastrando...' : 'Cadastrar produto'}
              </Button>
            </div>
          </form>
```

- [ ] **Step 3: Adicionar o campo no diálogo de edição**

No state de edição:

```typescript
  const [editForm, setEditForm] = useState({ barcode: '', name: '', unitPrice: '', costPrice: '' });
```

Em `openEdit`:

```typescript
  function openEdit(product: Product) {
    setProductToEdit(product);
    setEditForm({
      barcode: product.barcode,
      name: product.name,
      unitPrice: String(product.unitPrice ?? ''),
      costPrice: String(product.costPrice ?? ''),
    });
    setEditError(null);
  }
```

Em `handleEditSubmit`:

```typescript
      await api.patch(`products/${productToEdit.id}`, {
        barcode: editForm.barcode,
        name: editForm.name,
        unitPrice: editForm.unitPrice ? Number(editForm.unitPrice) : undefined,
        costPrice: editForm.costPrice ? Number(editForm.costPrice) : undefined,
      });
```

No JSX do diálogo de edição, logo depois do campo "Preço unitário (R$)":

```tsx
              <div className="space-y-1.5">
                <Label>Preço de custo (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.costPrice}
                  onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
                />
              </div>
```

- [ ] **Step 4: Adicionar a coluna na tabela**

No `TableHeader`, depois de "Preço unitário":

```tsx
              <TableHead>Preço unitário</TableHead>
              <TableHead>Preço de custo</TableHead>
```

No corpo da tabela, depois da célula de `unitPrice`:

```tsx
                  <TableCell>
                    {Number(product.unitPrice).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </TableCell>
                  <TableCell>
                    {Number(product.costPrice).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </TableCell>
```

E ajustar o `colSpan` dos estados vazios/loading da tabela de `4` para `5` (por causa da coluna nova).

- [ ] **Step 5: Verificar no browser**

Abrir o preview do web-panel (`preview_start` com a config `web-panel`), navegar até `/cadastros/produtos`, cadastrar um produto com preço de custo preenchido, confirmar que a tabela mostra as duas colunas, editar o produto e confirmar que o preço de custo é carregado e salvo corretamente. Tirar um screenshot como evidência.

- [ ] **Step 6: Commit**

```bash
git add web-panel/src/lib/types.ts "web-panel/src/app/(protected)/cadastros/produtos/page.tsx"
git commit -m "feat(web-panel): campo de preco de custo no cadastro de produto"
```

---

### Task 5: Web-panel — KPI de prejuízo de custo no dashboard

**Files:**
- Modify: `web-panel/src/lib/types.ts`
- Modify: `web-panel/src/app/(protected)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `LossSummaryReport.currentMonth.totalCostLoss`, `.costVariationPercent` (Task 3); componente `KpiCard` existente (`web-panel/src/components/kpi-card.tsx`, sem mudança — já aceita `label`/`value`/`variationPercent`).

- [ ] **Step 1: Atualizar os tipos**

Em `web-panel/src/lib/types.ts`:

```typescript
export interface LossByProductReportRow {
  productId: string;
  productName: string;
  totalQuantity: string;
  totalFinancialLoss: string;
  totalCostLoss: string;
}

export interface LossSummaryReport {
  currentMonth: { totalQuantity: number; totalFinancialLoss: number; totalCostLoss: number };
  previousMonth: { totalQuantity: number; totalFinancialLoss: number; totalCostLoss: number };
  financialVariationPercent: number | null;
  costVariationPercent: number | null;
}
```

- [ ] **Step 2: Adicionar o KPI no dashboard**

Em `web-panel/src/app/(protected)/dashboard/page.tsx`, no grid de KPIs (`grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4`), depois do card "Prejuízo total no mês" — mudar o grid pra `lg:grid-cols-5` pra caber o quinto card:

```tsx
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Prejuízo total no mês (venda)"
          value={formatBRL(summary?.currentMonth.totalFinancialLoss ?? 0)}
          variationPercent={summary?.financialVariationPercent ?? undefined}
        />
        <KpiCard
          label="Prejuízo de custo no mês"
          value={formatBRL(summary?.currentMonth.totalCostLoss ?? 0)}
          variationPercent={summary?.costVariationPercent ?? undefined}
          hint="Valor real pago pelos itens perdidos"
        />
        <KpiCard
          label="Itens descartados no mês"
          value={(summary?.currentMonth.totalQuantity ?? 0).toLocaleString('pt-BR')}
          hint={`Mês anterior: ${(summary?.previousMonth.totalQuantity ?? 0).toLocaleString('pt-BR')}`}
        />
        <KpiCard label="Produto mais perdido" value={topProduct} hint="No período filtrado abaixo" />
        <KpiCard label="Motivo mais comum" value={topReason} hint="No período filtrado abaixo" />
      </div>
```

- [ ] **Step 3: Verificar no browser**

Recarregar o dashboard no preview, confirmar que os 5 KPIs aparecem corretamente, incluindo o prejuízo de custo com o produto cadastrado no Task 3/4 (se ainda houver perdas registradas no período). Tirar screenshot.

- [ ] **Step 4: Commit**

```bash
git add web-panel/src/lib/types.ts "web-panel/src/app/(protected)/dashboard/page.tsx"
git commit -m "feat(web-panel): KPI de prejuizo de custo no dashboard"
```

---

## Self-Review Notes

- **Cobertura da spec (seção 1):** migration+entity (Task 1), DTOs+service (Task 2), relatórios (Task 3), formulário (Task 4), dashboard (Task 5) — cobre tudo que a spec pede para este item. Nenhuma mudança no mobile, como especificado.
- **Consistência de tipos:** `costPrice` é `number` na entity/DTO do backend, `string | number` no `Product`/`number` no `UpdateProductInput` do web-panel (mesmo padrão já usado por `unitPrice` em ambos os lados) — confirmado igual em todas as tasks.
- **Sem placeholders:** todos os steps têm código completo, sem "similar to" nem "add validation".

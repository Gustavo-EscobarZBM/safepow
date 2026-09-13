# Taxa de perda sobre faturamento (shrinkage rate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o gerente informar o faturamento mensal da empresa e mostrar no dashboard a taxa de perda sobre faturamento (shrinkage rate), a métrica padrão do varejo para saber se o prejuízo é grave dado o tamanho do negócio.

**Architecture:** Nova tabela `company_monthly_revenue` (um valor por empresa/ano/mês, RLS por tenant igual às demais tabelas). Novo módulo `company-revenue` com endpoints PUT/GET restritos a MANAGER. `LossesService.reportSummary()` passa a buscar o faturamento do mês corrente e expor `shrinkageRate` (perda de venda do mês ÷ faturamento do mês, `null` sem faturamento cadastrado) via uma função pura testável, no mesmo padrão já usado para `projectMonthEnd`. No web-panel, um card no próprio dashboard deixa o gerente editar o faturamento do mês e mostra a taxa calculada.

**Tech Stack:** NestJS + TypeORM (backend), Next.js + shadcn/ui (web-panel). Sem mudança no app mobile.

**Spec:** [docs/superpowers/specs/2026-09-12-dashboard-loss-prevention-features-design.md](../specs/2026-09-12-dashboard-loss-prevention-features-design.md), seção 3 "Taxa de perda sobre faturamento".

## Global Constraints

- RLS: toda tabela nova segue o padrão `tenant_isolation_<tabela>` (USING/WITH CHECK em `app.current_company_id`), `ENABLE`/`FORCE ROW LEVEL SECURITY`, e grant condicional pro role `inventory_saas_app` (só se o role existir — mesmo padrão do `DO $$ ... $$` já usado em `LossCatalogs1700000004000`).
- Endpoints novos de faturamento são `@Roles(UserRole.MANAGER)` — só gerente informa faturamento (igual ao spec, seção 3).
- Sem mudança no app mobile.
- Migrations rodam do HOST com `DB_ADMIN_USER` (nunca dentro do container) — `cd backend && npm run migration:run`.

---

### Task 1: Migration + entity de `company_monthly_revenue`

**Files:**
- Create: `backend/src/database/migrations/1700000008000-CompanyMonthlyRevenue.ts`
- Create: `backend/src/modules/company-revenue/company-monthly-revenue.entity.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: entidade `CompanyMonthlyRevenue { id, companyId, year, month, revenueAmount, createdAt, updatedAt }`, tabela `company_monthly_revenue` com índice único `(companyId, year, month)`. Tarefas seguintes usam essa entidade via `getTenantManager()`.

- [ ] **Step 1: Criar a migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

// Faturamento mensal informado manualmente pelo gerente — usado para calcular
// a taxa de perda sobre faturamento (shrinkage rate) no dashboard. Um valor
// por empresa/ano/mês; sem valor cadastrado, a taxa simplesmente não aparece
// (não tem como inferir faturamento).
export class CompanyMonthlyRevenue1700000008000 implements MigrationInterface {
  name = 'CompanyMonthlyRevenue1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "company_monthly_revenue" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "year" integer NOT NULL,
        "month" integer NOT NULL,
        "revenueAmount" numeric(12,2) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_company_monthly_revenue_company_year_month" ON "company_monthly_revenue" ("companyId", "year", "month")`,
    );
    await queryRunner.query(`ALTER TABLE "company_monthly_revenue" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "company_monthly_revenue" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_company_monthly_revenue" ON "company_monthly_revenue"
      USING ("companyId" = current_setting('app.current_company_id', true)::uuid)
      WITH CHECK ("companyId" = current_setting('app.current_company_id', true)::uuid)
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "company_monthly_revenue" TO inventory_saas_app';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_company_monthly_revenue" ON "company_monthly_revenue"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "company_monthly_revenue"`);
  }
}
```

- [ ] **Step 2: Criar a entity**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';

// Faturamento mensal informado manualmente pelo gerente (Painel > Dashboard) —
// usado só para calcular a taxa de perda sobre faturamento. Ver spec seção 3.
@Entity('company_monthly_revenue')
@Index(['companyId', 'year', 'month'], { unique: true })
export class CompanyMonthlyRevenue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  revenueAmount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 3: Registrar a entity no `app.module.ts`**

Em `backend/src/app.module.ts`, adicionar o import:

```typescript
import { CompanyMonthlyRevenue } from './modules/company-revenue/company-monthly-revenue.entity';
```

E incluir `CompanyMonthlyRevenue` no array `entities: [...]` da configuração do `TypeOrmModule.forRootAsync` (linha com `entities: [Company, User, Product, Loss, ImportJob, LossReason, LossLocation]`), ficando `entities: [Company, User, Product, Loss, ImportJob, LossReason, LossLocation, CompanyMonthlyRevenue]`.

- [ ] **Step 4: Rodar a migration e verificar**

Run (do host, dentro de `backend/`): `npm run migration:run`
Expected: log mostrando `CompanyMonthlyRevenue1700000008000` executada com sucesso, sem erros.

Verificar RLS aplicada: `docker exec -it <container_postgres> psql -U <DB_ADMIN_USER> -d <DB_NAME> -c "\d company_monthly_revenue"` deve mostrar a tabela; `SELECT polname FROM pg_policies WHERE tablename = 'company_monthly_revenue';` deve retornar `tenant_isolation_company_monthly_revenue`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/database/migrations/1700000008000-CompanyMonthlyRevenue.ts backend/src/modules/company-revenue/company-monthly-revenue.entity.ts backend/src/app.module.ts
git commit -m "feat(backend): tabela company_monthly_revenue com RLS por tenant"
```

---

### Task 2: `CompanyRevenueService` + `CompanyRevenueController` (TDD)

**Files:**
- Create: `backend/src/modules/company-revenue/dto/upsert-company-revenue.dto.ts`
- Create: `backend/src/modules/company-revenue/company-revenue.service.ts`
- Create: `backend/src/modules/company-revenue/company-revenue.service.spec.ts`
- Create: `backend/src/modules/company-revenue/company-revenue.controller.ts`
- Create: `backend/src/modules/company-revenue/company-revenue.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `CompanyMonthlyRevenue` entity (Task 1), `getTenantContext()`/`getTenantManager()` de `backend/src/common/tenant/tenant-storage.ts`, `JwtAuthGuard`/`SubscriptionGuard`/`RolesGuard`/`Roles` de `backend/src/common/guards/*`, `UserRole` de `backend/src/modules/users/user.entity.ts`.
- Produces: `CompanyRevenueService.upsert(year: number, month: number, dto: UpsertCompanyRevenueDto): Promise<CompanyMonthlyRevenue>` e `CompanyRevenueService.find(year: number, month: number): Promise<CompanyMonthlyRevenue | null>` — Task 3 usa `find` dentro de `reportSummary`.

- [ ] **Step 1: Criar o DTO**

```typescript
import { IsNumber, Min } from 'class-validator';

export class UpsertCompanyRevenueDto {
  @IsNumber()
  @Min(0)
  revenueAmount: number;
}
```

- [ ] **Step 2: Escrever o teste falho do service**

```typescript
import { BadRequestException } from '@nestjs/common';
import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from '../users/user.entity';
import { CompanyRevenueService } from './company-revenue.service';

const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
}

describe('CompanyRevenueService', () => {
  it('cria o faturamento do mês quando ainda não existe', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'rev-1', ...data })),
    };
    const service = new CompanyRevenueService();

    const result = await runWithTenantContext(manager, () =>
      service.upsert(2026, 4, { revenueAmount: 50000 }),
    );

    expect(manager.create).toHaveBeenCalledWith(expect.anything(), {
      companyId: COMPANY_ID,
      year: 2026,
      month: 4,
      revenueAmount: 50000,
    });
    expect(result).toMatchObject({ revenueAmount: 50000 });
  });

  it('substitui o valor do mês quando já existe (upsert)', async () => {
    const existing = { id: 'rev-1', companyId: COMPANY_ID, year: 2026, month: 4, revenueAmount: 50000 };
    const manager = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };
    const service = new CompanyRevenueService();

    const result = await runWithTenantContext(manager, () =>
      service.upsert(2026, 4, { revenueAmount: 62000 }),
    );

    expect(result).toMatchObject({ revenueAmount: 62000 });
  });

  it('rejeita mês fora do intervalo 1-12', async () => {
    const manager = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    const service = new CompanyRevenueService();

    await expect(
      runWithTenantContext(manager, () => service.upsert(2026, 13, { revenueAmount: 1000 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('find retorna null quando não há faturamento cadastrado no mês', async () => {
    const manager = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new CompanyRevenueService();

    const result = await runWithTenantContext(manager, () => service.find(2026, 4));

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `cd backend && npx jest company-revenue.service.spec.ts`
Expected: FAIL — `Cannot find module './company-revenue.service'` (ainda não existe).

- [ ] **Step 4: Implementar o service**

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { CompanyMonthlyRevenue } from './company-monthly-revenue.entity';
import { UpsertCompanyRevenueDto } from './dto/upsert-company-revenue.dto';

@Injectable()
export class CompanyRevenueService {
  private assertValidMonth(month: number): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mês inválido: deve ser um número entre 1 e 12.');
    }
  }

  async upsert(year: number, month: number, dto: UpsertCompanyRevenueDto): Promise<CompanyMonthlyRevenue> {
    this.assertValidMonth(month);
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const existing = await manager.findOne(CompanyMonthlyRevenue, {
      where: { companyId: companyId!, year, month },
    });
    if (existing) {
      existing.revenueAmount = dto.revenueAmount;
      return manager.save(existing);
    }

    const revenue = manager.create(CompanyMonthlyRevenue, {
      companyId: companyId!,
      year,
      month,
      revenueAmount: dto.revenueAmount,
    });
    return manager.save(revenue);
  }

  async find(year: number, month: number): Promise<CompanyMonthlyRevenue | null> {
    this.assertValidMonth(month);
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    return manager.findOne(CompanyMonthlyRevenue, { where: { companyId: companyId!, year, month } });
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `cd backend && npx jest company-revenue.service.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Criar o controller**

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CompanyRevenueService } from './company-revenue.service';
import { UpsertCompanyRevenueDto } from './dto/upsert-company-revenue.dto';

// Faturamento mensal informado pelo gerente — usado só para a taxa de perda
// sobre faturamento no dashboard (spec seção 3). Restrito a MANAGER.
@Controller('company-revenue')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class CompanyRevenueController {
  constructor(private readonly companyRevenueService: CompanyRevenueService) {}

  @Put(':year/:month')
  upsert(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: UpsertCompanyRevenueDto,
  ) {
    return this.companyRevenueService.upsert(year, month, dto);
  }

  @Get()
  find(@Query('year', ParseIntPipe) year: number, @Query('month', ParseIntPipe) month: number) {
    return this.companyRevenueService.find(year, month);
  }
}
```

- [ ] **Step 7: Criar o module**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { CompanyMonthlyRevenue } from './company-monthly-revenue.entity';
import { CompanyRevenueController } from './company-revenue.controller';
import { CompanyRevenueService } from './company-revenue.service';

@Module({
  // Company precisa estar registrada aqui porque o SubscriptionGuard (usado no
  // controller) injeta o repositório de Company.
  imports: [TypeOrmModule.forFeature([CompanyMonthlyRevenue, Company])],
  controllers: [CompanyRevenueController],
  providers: [CompanyRevenueService],
  exports: [CompanyRevenueService],
})
export class CompanyRevenueModule {}
```

- [ ] **Step 8: Registrar o module no `app.module.ts`**

Adicionar o import:

```typescript
import { CompanyRevenueModule } from './modules/company-revenue/company-revenue.module';
```

E incluir `CompanyRevenueModule` no array `imports: [...]` do `@Module`, logo após `LossesModule`.

- [ ] **Step 9: Rodar a suíte completa do backend**

Run: `cd backend && npm test`
Expected: todos os testes passam, incluindo os 4 novos de `CompanyRevenueService`.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/company-revenue backend/src/app.module.ts
git commit -m "feat(backend): endpoints PUT/GET de faturamento mensal (company-revenue)"
```

---

### Task 3: `shrinkageRate` puro + integração no `reportSummary` (TDD)

**Files:**
- Create: `backend/src/modules/losses/losses-shrinkage.ts`
- Create: `backend/src/modules/losses/losses-shrinkage.spec.ts`
- Modify: `backend/src/modules/losses/losses.service.ts`
- Modify: `backend/src/modules/losses/losses.module.ts`

**Interfaces:**
- Consumes: `CompanyMonthlyRevenue` entity (Task 1), `getTenantContext()`/`getTenantManager()`.
- Produces: `computeShrinkageRate(financialLoss: number, revenueAmount: number | null): number | null` — pura, testável isoladamente. `reportSummary()` passa a retornar também `shrinkageRate: number | null`.

- [ ] **Step 1: Escrever o teste falho da função pura**

```typescript
import { computeShrinkageRate } from './losses-shrinkage';

describe('computeShrinkageRate', () => {
  it('calcula a taxa como percentual de perda sobre faturamento', () => {
    // 1000 de perda sobre 50000 de faturamento = 2%
    expect(computeShrinkageRate(1000, 50000)).toBeCloseTo(2);
  });

  it('retorna null quando não há faturamento cadastrado (null)', () => {
    expect(computeShrinkageRate(1000, null)).toBeNull();
  });

  it('retorna null quando o faturamento cadastrado é zero', () => {
    expect(computeShrinkageRate(1000, 0)).toBeNull();
  });

  it('retorna 0 quando não há perda no mês', () => {
    expect(computeShrinkageRate(0, 50000)).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd backend && npx jest losses-shrinkage.spec.ts`
Expected: FAIL — `Cannot find module './losses-shrinkage'`.

- [ ] **Step 3: Implementar a função pura**

```typescript
/**
 * Taxa de perda sobre faturamento (shrinkage rate): a métrica padrão do
 * varejo para saber se o prejuízo é grave dado o tamanho do negócio — perda
 * em valor absoluto sozinha não diz muito sem o faturamento como referência.
 * Usa a perda a preço de venda (mesma base do faturamento), não a de custo.
 * Sem faturamento cadastrado para o mês, não tem como calcular — retorna null
 * em vez de enganar com uma divisão por zero ou um número sem sentido.
 */
export function computeShrinkageRate(financialLoss: number, revenueAmount: number | null): number | null {
  if (!revenueAmount) return null;
  return (financialLoss / revenueAmount) * 100;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd backend && npx jest losses-shrinkage.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Integrar no `reportSummary`**

Em `backend/src/modules/losses/losses.service.ts`, adicionar os imports (junto aos já existentes no topo do arquivo):

```typescript
import { CompanyMonthlyRevenue } from '../company-revenue/company-monthly-revenue.entity';
import { computeShrinkageRate } from './losses-shrinkage';
```

Substituir o método `reportSummary()` (linhas 143-169) por:

```typescript
  async reportSummary() {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Sequencial de propósito: as duas consultas dividem o mesmo QueryRunner
    // (uma conexão/transação por requisição — ver TenantContextMiddleware),
    // que não suporta duas queries concorrentes.
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

    const projectedMonthEnd = projectMonthEnd(currentMonth, previousMonth, now);

    const manager = getTenantManager();
    const revenue = await manager.findOne(CompanyMonthlyRevenue, {
      where: { year: now.getFullYear(), month: now.getMonth() + 1 },
    });
    const shrinkageRate = computeShrinkageRate(
      currentMonth.totalFinancialLoss,
      revenue ? Number(revenue.revenueAmount) : null,
    );

    return {
      currentMonth,
      previousMonth,
      financialVariationPercent,
      costVariationPercent,
      projectedMonthEnd,
      shrinkageRate,
    };
  }
```

Nota: `manager.findOne` já filtra por tenant automaticamente via RLS (a conexão roda com `app.current_company_id` setado pelo `TenantContextMiddleware` — mesmo padrão de toda consulta neste service), então não é preciso filtrar `companyId` manualmente aqui.

- [ ] **Step 6: Registrar a entity no `LossesModule`**

Em `backend/src/modules/losses/losses.module.ts`, adicionar o import:

```typescript
import { CompanyMonthlyRevenue } from '../company-revenue/company-monthly-revenue.entity';
```

E incluir `CompanyMonthlyRevenue` no `TypeOrmModule.forFeature([...])`, ficando `TypeOrmModule.forFeature([Loss, Company, CompanyMonthlyRevenue])`.

- [ ] **Step 7: Rodar a suíte completa do backend**

Run: `cd backend && npm test`
Expected: todos os testes passam (os novos de `losses-shrinkage` incluídos).

- [ ] **Step 8: Verificar via curl com o backend rodando**

Com o backend de pé e um usuário MANAGER logado (token em `$TOKEN`):

```bash
curl -X PUT http://localhost:3000/api/company-revenue/2026/9 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"revenueAmount": 50000}'
curl http://localhost:3000/api/losses/reports/summary -H "Authorization: Bearer $TOKEN"
```

Expected: o segundo curl retorna um campo `shrinkageRate` numérico (não `null`) coerente com o prejuízo do mês já existente ÷ 50000 × 100.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/losses/losses-shrinkage.ts backend/src/modules/losses/losses-shrinkage.spec.ts backend/src/modules/losses/losses.service.ts backend/src/modules/losses/losses.module.ts
git commit -m "feat(backend): reportSummary expoe shrinkageRate (perda sobre faturamento)"
```

---

### Task 4: Web-panel — faturamento do mês e taxa no dashboard

**Files:**
- Modify: `web-panel/src/lib/types.ts`
- Modify: `web-panel/src/lib/api-client.ts`
- Modify: `web-panel/src/app/api/backend/[...path]/route.ts`
- Modify: `web-panel/src/app/(protected)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `PUT /company-revenue/:year/:month` (body `{ revenueAmount }`), `GET /company-revenue?year=&month=` (Task 2), `LossSummaryReport.shrinkageRate` (Task 3).

- [ ] **Step 1: Atualizar os tipos**

Em `web-panel/src/lib/types.ts`, adicionar (após a interface `LossSummaryReport` existente):

```typescript
export interface CompanyMonthlyRevenue {
  id: string;
  year: number;
  month: number;
  revenueAmount: string | number;
}
```

E adicionar o campo `shrinkageRate: number | null;` dentro de `LossSummaryReport`, junto aos outros campos do topo (ao lado de `costVariationPercent`).

- [ ] **Step 2: Adicionar o método `put` no `api-client.ts`**

Em `web-panel/src/lib/api-client.ts`, no objeto `export const api = { ... }`, adicionar a linha:

```typescript
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
```

- [ ] **Step 3: Encaminhar `PUT` no proxy**

Em `web-panel/src/app/api/backend/[...path]/route.ts`, adicionar, junto aos outros `export async function`:

```typescript
export async function PUT(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}
```

- [ ] **Step 4: Card de faturamento + taxa no dashboard**

Em `web-panel/src/app/(protected)/dashboard/page.tsx`:

Adicionar aos imports existentes:

```typescript
import type { CompanyMonthlyRevenue } from '@/lib/types';
```

(este tipo entra junto no mesmo `import type { ... } from '@/lib/types';` já existente, não como uma linha separada)

Adicionar estado, logo abaixo de `const [productQuery, setProductQuery] = useState('');`:

```typescript
  const now = useMemo(() => new Date(), []);
  const [revenueInput, setRevenueInput] = useState('');
  const [revenueSaving, setRevenueSaving] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);
```

Adicionar, dentro do `useEffect` que já carrega o summary (logo após a chamada `api.get<LossSummaryReport>('losses/reports/summary')...`), o carregamento do faturamento do mês corrente:

```typescript
    api
      .get<CompanyMonthlyRevenue | null>(`company-revenue?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .then((revenue) => setRevenueInput(revenue ? String(revenue.revenueAmount) : ''))
      .catch(() => {});
```

Adicionar a função de salvar, próxima das outras funções do componente (antes de `const topProduct = ...`):

```typescript
  async function saveRevenue() {
    const amount = Number(revenueInput.replace(',', '.'));
    if (!revenueInput || Number.isNaN(amount) || amount < 0) {
      setRevenueError('Informe um valor válido.');
      return;
    }
    setRevenueSaving(true);
    setRevenueError(null);
    try {
      await api.put(`company-revenue/${now.getFullYear()}/${now.getMonth() + 1}`, { revenueAmount: amount });
      const updatedSummary = await api.get<LossSummaryReport>('losses/reports/summary');
      setSummary(updatedSummary);
    } catch (e) {
      setRevenueError(e instanceof ApiError ? e.message : 'Erro ao salvar faturamento.');
    } finally {
      setRevenueSaving(false);
    }
  }
```

Adicionar o card no JSX, logo após o `</div>` que fecha o grid de KPIs (`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5`) e antes do bloco de projeção de fechamento de mês (`{summary && summary.currentMonth.totalFinancialLoss > 0 && (`):

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Faturamento do mês e taxa de perda</CardTitle>
          <CardDescription>
            Informe o faturamento do mês corrente para ver a perda como percentual da receita — a métrica
            padrão do varejo (faixa normal: 1–2%).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label>Faturamento do mês (R$)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="w-48"
              value={revenueInput}
              onChange={(e) => setRevenueInput(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={saveRevenue} disabled={revenueSaving}>
            {revenueSaving ? 'Salvando...' : 'Salvar faturamento'}
          </Button>
          {revenueError && <p className="text-sm text-destructive">{revenueError}</p>}
          {summary?.shrinkageRate !== null && summary?.shrinkageRate !== undefined && (
            <div className="sm:ml-auto">
              <p className="text-xs text-muted-foreground">Taxa de perda sobre faturamento</p>
              <p
                className={cn(
                  'font-display text-2xl',
                  summary.shrinkageRate > 2 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {summary.shrinkageRate.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%
              </p>
            </div>
          )}
        </CardContent>
      </Card>
```

Adicionar o import de `cn` (usado acima para colorir a taxa quando acima de 2%), junto aos demais imports:

```typescript
import { cn } from '@/lib/utils';
```

- [ ] **Step 5: Verificar no navegador**

Com o backend e o web-panel rodando (`preview_start`), logar como um gerente, abrir `/dashboard`, preencher "Faturamento do mês (R$)" com um valor, clicar "Salvar faturamento" e confirmar que a "Taxa de perda sobre faturamento" aparece com um percentual coerente com `currentMonth.totalFinancialLoss ÷ faturamento`. Recarregar a página e confirmar que o valor de faturamento digitado continua preenchido (persistiu no backend).

- [ ] **Step 6: Commit**

```bash
git add web-panel/src/lib/types.ts web-panel/src/lib/api-client.ts "web-panel/src/app/api/backend/[...path]/route.ts" "web-panel/src/app/(protected)/dashboard/page.tsx"
git commit -m "feat(web-panel): card de faturamento e taxa de perda sobre faturamento no dashboard"
```

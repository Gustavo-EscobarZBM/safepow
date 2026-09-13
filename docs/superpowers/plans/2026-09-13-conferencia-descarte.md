# Conferência de descarte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o gerente ativar uma etapa opcional de conferência sobre o que foi descartado: designa um conferente (funcionário ou gerente), toda perda registrada nessa empresa fica pendente até esse conferente confirmar, o funcionário que registrou vê um aviso claro no app, e o conferente/gerente têm uma tela pra revisar e confirmar as pendências.

**Architecture:** Duas colunas novas em `companies` (liga/desliga + quem é o conferente) e três em `losses` (trava se aquele registro específico precisa de conferência, e quando/quem confirmou — travado no momento da criação, mudar a configuração depois não afeta perdas já criadas). Backend expõe autoatendimento de configuração (`/companies/me/settings`, distinto do Painel Master) e duas rotas de conferência (`/losses/pending-verification`, `/losses/:id/verify`) cuja regra de acesso é "MANAGER da empresa OU o funcionário designado como conferente" — verificada dentro do service, não só por `@Roles`. O app mobile aprende se a empresa tem a conferência ativada e se o usuário logado é o conferente **no momento do login** (campo novo no payload de `/auth/login`, guardado no mesmo `AuthSession` que já persiste `role`/`companyId`) — é assim que o aviso aparece offline, sem chamada de rede extra no momento de salvar a perda.

**Tech Stack:** NestJS + TypeORM (backend), Next.js + shadcn/ui (web-panel), Flutter/Dart (mobile).

**Spec:** [docs/superpowers/specs/2026-09-12-dashboard-loss-prevention-features-design.md](../specs/2026-09-12-dashboard-loss-prevention-features-design.md), seção 5 "Conferência de descarte".

## Global Constraints

- `losses.requiresVerification` é travado no momento da criação (`LossesService.create`) a partir do valor de `company.lossVerificationEnabled` naquele instante — mudar a configuração depois NÃO reprocessa perdas já criadas.
- Acesso a `GET /losses/pending-verification` e `PATCH /losses/:id/verify`: MANAGER da empresa OU o usuário cujo id bate com `company.lossVerifierId` (mesmo que seja EMPLOYEE) — por isso a checagem fica dentro do service (`assertCanManageVerification`), não só no `@Roles` do controller.
- Novo endpoint de autoatendimento é `/companies/me/settings` (arquivo/controller separado de `CompaniesController`, que é `/master/companies`, exclusivo de `MASTER_ADMIN` e nunca deve ganhar uma rota fora desse escopo).
- Mobile: `AuthSession.lossVerificationEnabled`/`isLossVerifier` só atualizam no próximo login — não há refresh automático enquanto a sessão já está aberta (trade-off aceito com o usuário: é o preço do padrão "otimista, sem chamada de rede" no momento de salvar a perda).
- Tela "Conferências pendentes" (mobile) e página "Conferências" (web) sempre buscam ao vivo do servidor — sem cache local.
- Sem contador de pendentes no botão da Home do mobile (evita forçar uma chamada de rede toda vez que a Home abre) — a contagem só aparece dentro da tela dedicada.

---

### Task 1: Migration + entidades (`Company` e `Loss`)

**Files:**
- Create: `backend/src/database/migrations/1700000009000-LossVerification.ts`
- Modify: `backend/src/modules/companies/company.entity.ts`
- Modify: `backend/src/modules/losses/loss.entity.ts`

**Interfaces:**
- Produces: `Company.lossVerificationEnabled: boolean`, `Company.lossVerifierId: string | null`, `Loss.requiresVerification: boolean`, `Loss.verifiedAt: Date | null`, `Loss.verifiedByUserId: string | null`, `Loss.verifiedBy: User | null`. Tarefas seguintes leem/gravam esses campos via `getTenantManager()`.

- [ ] **Step 1: Criar a migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

// Conferência de descarte (spec seção 5): etapa opcional de segunda validação
// sobre o que foi descartado. ON DELETE SET NULL nas duas FKs novas pra users
// — remover o usuário que era conferente não pode travar a exclusão dele nem
// apagar o histórico de quem já confirmou perdas antigas.
export class LossVerification1700000009000 implements MigrationInterface {
  name = 'LossVerification1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN "lossVerificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN "lossVerifierId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "losses" ADD COLUMN "requiresVerification" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "losses" ADD COLUMN "verifiedAt" timestamptz NULL`);
    await queryRunner.query(
      `ALTER TABLE "losses" ADD COLUMN "verifiedByUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "verifiedByUserId"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "verifiedAt"`);
    await queryRunner.query(`ALTER TABLE "losses" DROP COLUMN "requiresVerification"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "lossVerifierId"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "lossVerificationEnabled"`);
  }
}
```

- [ ] **Step 2: Atualizar a entity `Company`**

Em `backend/src/modules/companies/company.entity.ts`, adicionar após o campo `lastManualUnlockAt`:

```typescript
  // Conferência de descarte (opcional, ativada pelo gerente) — spec seção 5.
  @Column({ type: 'boolean', default: false })
  lossVerificationEnabled: boolean;

  @Column({ type: 'uuid', nullable: true })
  lossVerifierId: string | null;
```

- [ ] **Step 3: Atualizar a entity `Loss`**

Em `backend/src/modules/losses/loss.entity.ts`, adicionar o import de `User` já existe; adicionar após o campo `imageUrl`:

```typescript
  // Conferência de descarte (spec seção 5) — travado no momento da criação a
  // partir de company.lossVerificationEnabled (ver LossesService.create).
  @Column({ type: 'boolean', default: false })
  requiresVerification: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedByUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'verifiedByUserId' })
  verifiedBy: User | null;
```

- [ ] **Step 4: Rodar a migration e verificar**

Run: `cd backend && npm run migration:run`
Expected: log mostrando `LossVerification1700000009000` executada com sucesso.

- [ ] **Step 5: Commit**

```bash
git add backend/src/database/migrations/1700000009000-LossVerification.ts backend/src/modules/companies/company.entity.ts backend/src/modules/losses/loss.entity.ts
git commit -m "feat(backend): colunas de conferencia de descarte em companies e losses"
```

---

### Task 2: `/companies/me/settings` (TDD)

**Files:**
- Create: `backend/src/modules/companies/dto/update-company-settings.dto.ts`
- Create: `backend/src/modules/companies/company-settings.controller.ts`
- Modify: `backend/src/modules/companies/companies.service.ts`
- Modify: `backend/src/modules/companies/__tests__/companies.service.spec.ts`
- Modify: `backend/src/modules/companies/companies.module.ts`

**Interfaces:**
- Consumes: `getTenantContext()`/`getTenantManager()`, `Company`, `User` entities.
- Produces: `CompaniesService.getMySettings(): Promise<{lossVerificationEnabled, lossVerifierId}>`, `CompaniesService.updateMySettings(dto): Promise<{lossVerificationEnabled, lossVerifierId}>`, rotas `GET/PATCH /companies/me/settings`.

- [ ] **Step 1: Criar o DTO**

```typescript
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsBoolean()
  lossVerificationEnabled?: boolean;

  // Undefined = não mexe; null = limpa o conferente; string = define um novo.
  @IsOptional()
  @IsUUID()
  lossVerifierId?: string | null;
}
```

- [ ] **Step 2: Escrever os testes falhos**

Adicionar ao final de `backend/src/modules/companies/__tests__/companies.service.spec.ts` (os imports `tenantStorage` e `UserRole` são novos, adicionar no topo do arquivo junto aos já existentes):

```typescript
import { tenantStorage } from '../../../common/tenant/tenant-storage';
import { UserRole } from '../../users/user.entity';
```

```typescript
describe('CompaniesService — configurações de conferência de descarte', () => {
  const COMPANY_ID = 'company-1';

  function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
    return tenantStorage.run({ userId: 'user-1', role: UserRole.MANAGER, companyId: COMPANY_ID, manager }, fn);
  }

  it('getMySettings retorna as configurações da própria empresa', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: COMPANY_ID, lossVerificationEnabled: true, lossVerifierId: 'user-2' }),
    };
    const { service } = makeService(null);

    const result = await runWithTenantContext(manager, () => service.getMySettings());

    expect(result).toEqual({ lossVerificationEnabled: true, lossVerifierId: 'user-2' });
  });

  it('updateMySettings ativa a conferência e define o conferente', async () => {
    const company = { id: COMPANY_ID, lossVerificationEnabled: false, lossVerifierId: null };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(company).mockResolvedValueOnce({ id: 'user-2' }),
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
    };
    const { service } = makeService(null);

    const result = await runWithTenantContext(manager, () =>
      service.updateMySettings({ lossVerificationEnabled: true, lossVerifierId: 'user-2' }),
    );

    expect(result).toEqual({ lossVerificationEnabled: true, lossVerifierId: 'user-2' });
  });

  it('updateMySettings rejeita um conferente que não existe na empresa', async () => {
    const company = { id: COMPANY_ID, lossVerificationEnabled: false, lossVerifierId: null };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(company).mockResolvedValueOnce(null),
      save: jest.fn(),
    };
    const { service } = makeService(null);

    await expect(
      runWithTenantContext(manager, () => service.updateMySettings({ lossVerifierId: 'user-inexistente' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('updateMySettings permite limpar o conferente enviando null', async () => {
    const company = { id: COMPANY_ID, lossVerificationEnabled: true, lossVerifierId: 'user-2' };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(company),
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
    };
    const { service } = makeService(null);

    const result = await runWithTenantContext(manager, () => service.updateMySettings({ lossVerifierId: null }));

    expect(result.lossVerifierId).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `cd backend && npx jest companies.service.spec.ts`
Expected: FAIL — `service.getMySettings is not a function`.

- [ ] **Step 4: Implementar no `CompaniesService`**

Adicionar o import no topo de `backend/src/modules/companies/companies.service.ts`:

```typescript
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
```

E adicionar os dois métodos, logo após `create()`:

```typescript
  async getMySettings(): Promise<{ lossVerificationEnabled: boolean; lossVerifierId: string | null }> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    const company = await manager.findOne(Company, { where: { id: companyId! } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return { lossVerificationEnabled: company.lossVerificationEnabled, lossVerifierId: company.lossVerifierId };
  }

  /**
   * Autoatendimento do gerente — diferente de update() (Painel Master, dados
   * cadastrais/billing de qualquer empresa). Restrito aos dois campos da
   * conferência de descarte.
   */
  async updateMySettings(
    dto: UpdateCompanySettingsDto,
  ): Promise<{ lossVerificationEnabled: boolean; lossVerifierId: string | null }> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    const company = await manager.findOne(Company, { where: { id: companyId! } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    if (dto.lossVerificationEnabled !== undefined) {
      company.lossVerificationEnabled = dto.lossVerificationEnabled;
    }
    if (dto.lossVerifierId !== undefined) {
      if (dto.lossVerifierId !== null) {
        const verifier = await manager.findOne(User, { where: { id: dto.lossVerifierId } });
        if (!verifier) throw new NotFoundException('Usuário conferente não encontrado.');
      }
      company.lossVerifierId = dto.lossVerifierId;
    }

    await manager.save(company);
    return { lossVerificationEnabled: company.lossVerificationEnabled, lossVerifierId: company.lossVerifierId };
  }
```

Adicionar o import do DTO no topo do arquivo:

```typescript
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd backend && npx jest companies.service.spec.ts`
Expected: PASS (todos, incluindo os 4 novos).

- [ ] **Step 6: Criar o controller**

```typescript
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CompaniesService } from './companies.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

// Autoatendimento do gerente para as configurações da própria empresa — hoje
// só a conferência de descarte (spec seção 5). Distinto de /master/companies
// (Painel Master, MASTER_ADMIN, dados cadastrais/billing de qualquer empresa).
@Controller('companies/me')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class CompanySettingsController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('settings')
  getSettings() {
    return this.companiesService.getMySettings();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateCompanySettingsDto) {
    return this.companiesService.updateMySettings(dto);
  }
}
```

- [ ] **Step 7: Registrar o controller no module**

Em `backend/src/modules/companies/companies.module.ts`, adicionar o import e incluir no array `controllers`:

```typescript
import { CompanySettingsController } from './company-settings.controller';
```

```typescript
  controllers: [CompaniesController, CompanySettingsController],
```

- [ ] **Step 8: Rodar a suíte completa do backend**

Run: `cd backend && npm test`
Expected: todos os testes passam.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/companies
git commit -m "feat(backend): autoatendimento de configuracoes da empresa (conferencia de descarte)"
```

---

### Task 3: `LossesService.create` grava `requiresVerification` + `pending-verification`/`verify` (TDD)

**Files:**
- Modify: `backend/src/modules/losses/losses.service.ts`
- Modify: `backend/src/modules/losses/losses.service.spec.ts`
- Modify: `backend/src/modules/losses/losses.controller.ts`

**Interfaces:**
- Consumes: `Company` entity (já registrada em `LossesModule`).
- Produces: `LossesService.findPendingVerification(): Promise<Loss[]>`, `LossesService.verify(id): Promise<Loss>`, rotas `GET /losses/pending-verification`, `PATCH /losses/:id/verify`.

- [ ] **Step 1: Escrever os testes falhos**

Adicionar ao topo de `backend/src/modules/losses/losses.service.spec.ts` os imports novos:

```typescript
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
```

(substitui a linha `import { NotFoundException } from '@nestjs/common';` já existente)

Adicionar, dentro do `describe('LossesService.create ...')` já existente, dois novos testes:

```typescript
  it('grava requiresVerification=true quando a empresa tem a conferência de descarte ativada', async () => {
    const manager = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'loss-1', ...data })),
    };
    manager.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: PRODUCT_ID })
      .mockResolvedValueOnce({ id: REASON_ID })
      .mockResolvedValueOnce({ id: LOCATION_ID })
      .mockResolvedValueOnce({ id: COMPANY_ID, lossVerificationEnabled: true });

    const service = new LossesService();

    const result = await runWithTenantContext(manager, () =>
      service.create({
        clientGeneratedId: CLIENT_GENERATED_ID,
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        reasonId: REASON_ID,
        description: 'Teste',
        occurredAt: new Date().toISOString(),
      }),
    );

    expect(result.requiresVerification).toBe(true);
  });

  it('grava requiresVerification=false quando a empresa não tem a conferência ativada', async () => {
    const manager = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'loss-1', ...data })),
    };
    manager.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: PRODUCT_ID })
      .mockResolvedValueOnce({ id: REASON_ID })
      .mockResolvedValueOnce({ id: LOCATION_ID })
      .mockResolvedValueOnce({ id: COMPANY_ID, lossVerificationEnabled: false });

    const service = new LossesService();

    const result = await runWithTenantContext(manager, () =>
      service.create({
        clientGeneratedId: CLIENT_GENERATED_ID,
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        reasonId: REASON_ID,
        description: 'Teste',
        occurredAt: new Date().toISOString(),
      }),
    );

    expect(result.requiresVerification).toBe(false);
  });
```

No final do arquivo, um novo `describe` para `findPendingVerification`/`verify` (usa `role` e `userId` diferentes por teste, por isso um helper próprio em vez de reaproveitar `runWithTenantContext`, que fixa `role: EMPLOYEE`):

```typescript
function runAs<T>(role: UserRole, userId: string, manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId, role, companyId: COMPANY_ID, manager }, fn);
}

describe('LossesService.findPendingVerification / verify (conferência de descarte)', () => {
  it('MANAGER pode listar as pendências de conferência', async () => {
    const manager = { find: jest.fn().mockResolvedValue([{ id: 'loss-1' }]) };
    const service = new LossesService();

    const result = await runAs(UserRole.MANAGER, 'manager-1', manager, () => service.findPendingVerification());

    expect(result).toEqual([{ id: 'loss-1' }]);
  });

  it('o funcionário designado como conferente pode listar as pendências', async () => {
    const manager = {
      find: jest.fn().mockResolvedValue([{ id: 'loss-1' }]),
      findOne: jest.fn().mockResolvedValue({ id: COMPANY_ID, lossVerifierId: 'emp-verificador' }),
    };
    const service = new LossesService();

    const result = await runAs(UserRole.EMPLOYEE, 'emp-verificador', manager, () =>
      service.findPendingVerification(),
    );

    expect(result).toEqual([{ id: 'loss-1' }]);
  });

  it('um funcionário que não é o conferente designado não pode listar as pendências', async () => {
    const manager = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ id: COMPANY_ID, lossVerifierId: 'emp-verificador' }),
    };
    const service = new LossesService();

    await expect(
      runAs(UserRole.EMPLOYEE, 'outro-funcionario', manager, () => service.findPendingVerification()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('verify marca verifiedAt e verifiedByUserId quando quem confirma é MANAGER', async () => {
    const loss = { id: 'loss-1', requiresVerification: true, verifiedAt: null, verifiedByUserId: null };
    const manager = {
      findOne: jest.fn().mockResolvedValue(loss),
      save: jest.fn().mockImplementation((l) => Promise.resolve(l)),
    };
    const service = new LossesService();

    const result = await runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('loss-1'));

    expect(result.verifiedByUserId).toBe('manager-1');
    expect(result.verifiedAt).toBeInstanceOf(Date);
  });

  it('verify lança NotFoundException quando a perda não existe', async () => {
    const manager = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new LossesService();

    await expect(
      runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('id-invalido')),
    ).rejects.toThrow(NotFoundException);
  });

  it('verify lança ConflictException quando a perda já foi conferida', async () => {
    const loss = { id: 'loss-1', requiresVerification: true, verifiedAt: new Date() };
    const manager = { findOne: jest.fn().mockResolvedValue(loss) };
    const service = new LossesService();

    await expect(runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('loss-1'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('verify lança BadRequestException quando a perda não requer conferência', async () => {
    const loss = { id: 'loss-1', requiresVerification: false, verifiedAt: null };
    const manager = { findOne: jest.fn().mockResolvedValue(loss) };
    const service = new LossesService();

    await expect(runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('loss-1'))).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && npx jest losses.service.spec.ts`
Expected: FAIL — `result.requiresVerification` undefined nos dois primeiros testes novos, e `service.findPendingVerification is not a function` nos demais.

- [ ] **Step 3: Implementar**

Em `backend/src/modules/losses/losses.service.ts`, ajustar o import de `@nestjs/common` (linha 1) para:

```typescript
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
```

Ajustar o import de `typeorm` (linha 3) para incluir `IsNull`:

```typescript
import { Between, IsNull } from 'typeorm';
```

Adicionar o import da entity `Company`:

```typescript
import { Company } from '../companies/company.entity';
```

No método `create()`, adicionar a busca da empresa antes de `manager.create(Loss, {...})` e o campo `requiresVerification` no objeto criado:

```typescript
    const company = await manager.findOne(Company, { where: { id: companyId! } });

    const loss = manager.create(Loss, {
      companyId: companyId!,
      clientGeneratedId: dto.clientGeneratedId,
      productId: dto.productId,
      reportedByUserId: userId,
      quantity: dto.quantity ?? 1,
      locationId: dto.locationId,
      reasonId: dto.reasonId,
      description: dto.description || null,
      imageUrl: dto.imageUrl ?? null,
      occurredAt: new Date(dto.occurredAt),
      source: dto.source ?? null,
      requiresVerification: company?.lossVerificationEnabled ?? false,
    });
    return manager.save(loss);
```

Adicionar os três métodos novos, logo após `reportSuspiciousPatterns()`:

```typescript
  /**
   * Card "Conferências pendentes": lista perdas com requiresVerification=true
   * e ainda não conferidas. Acesso: MANAGER da empresa OU o funcionário
   * designado como lossVerifierId — por isso a checagem não é só @Roles no
   * controller (ver assertCanManageVerification).
   */
  async findPendingVerification(): Promise<Loss[]> {
    await this.assertCanManageVerification();
    const manager = getTenantManager();
    return manager.find(Loss, {
      where: { requiresVerification: true, verifiedAt: IsNull() },
      relations: { product: true, reportedBy: true, reason: true, location: true },
      order: { occurredAt: 'ASC' },
    });
  }

  /** Confirma a conferência de uma perda pendente — mesma regra de acesso de findPendingVerification. */
  async verify(id: string): Promise<Loss> {
    await this.assertCanManageVerification();
    const { userId } = getTenantContext();
    const manager = getTenantManager();

    const loss = await manager.findOne(Loss, { where: { id } });
    if (!loss) throw new NotFoundException('Perda não encontrada.');
    if (!loss.requiresVerification) throw new BadRequestException('Esta perda não requer conferência.');
    if (loss.verifiedAt) throw new ConflictException('Esta perda já foi conferida.');

    loss.verifiedAt = new Date();
    loss.verifiedByUserId = userId;
    return manager.save(loss);
  }

  private async assertCanManageVerification(): Promise<void> {
    const { role, userId, companyId } = getTenantContext();
    if (role === UserRole.MANAGER) return;

    const manager = getTenantManager();
    const company = await manager.findOne(Company, { where: { id: companyId! } });
    if (company?.lossVerifierId === userId) return;

    throw new ForbiddenException('Você não tem permissão para acessar conferências de descarte.');
  }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && npx jest losses.service.spec.ts`
Expected: PASS (todos, incluindo os 8 novos).

- [ ] **Step 5: Adicionar as rotas no controller**

Em `backend/src/modules/losses/losses.controller.ts`, adicionar logo após `reportSuspiciousPatterns()`:

```typescript
  // Card "Conferências pendentes" — acesso: MANAGER ou o funcionário
  // designado como conferente (checado dentro do service, não só por papel).
  @Get('pending-verification')
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  findPendingVerification() {
    return this.lossesService.findPendingVerification();
  }

  @Patch(':id/verify')
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  verify(@Param('id', ParseUUIDPipe) id: string) {
    return this.lossesService.verify(id);
  }
```

- [ ] **Step 6: Rodar a suíte completa do backend**

Run: `cd backend && npm test`
Expected: todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/losses/losses.service.ts backend/src/modules/losses/losses.service.spec.ts backend/src/modules/losses/losses.controller.ts
git commit -m "feat(backend): losses.create trava requiresVerification; endpoints de conferencia"
```

---

### Task 4: `/auth/login` expõe `lossVerificationEnabled`/`isLossVerifier` (TDD)

**Files:**
- Create: `backend/src/modules/auth/auth.service.spec.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`

**Interfaces:**
- Produces: `AuthService.login()` retorna também `lossVerificationEnabled: boolean` e `isLossVerifier: boolean`. Consumido pelo mobile (Task 6).

- [ ] **Step 1: Escrever os testes falhos**

```typescript
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { CompanyStatus } from '../companies/company.entity';
import { UserRole } from '../users/user.entity';

function makeService(overrides: { lookupRow?: any; company?: any } = {}) {
  const dataSource = {
    query: jest.fn().mockResolvedValue([
      overrides.lookupRow ?? {
        id: 'user-1',
        companyId: 'company-1',
        passwordHash: 'hash',
        role: UserRole.MANAGER,
        isActive: true,
        name: 'Gerente Teste',
      },
    ]),
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('fake-token') };
  const companiesRepository = {
    findOne: jest.fn().mockResolvedValue(
      overrides.company ?? {
        id: 'company-1',
        status: CompanyStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastManualUnlockAt: null,
        lossVerificationEnabled: false,
        lossVerifierId: null,
      },
    ),
    save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
  };
  const service = new AuthService(dataSource as any, jwtService as any, companiesRepository as any);
  return { service };
}

describe('AuthService.login — payload de conferência de descarte', () => {
  beforeEach(() => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('retorna lossVerificationEnabled=true e isLossVerifier=true quando o usuário é o conferente', async () => {
    const { service } = makeService({
      company: {
        id: 'company-1',
        status: CompanyStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastManualUnlockAt: null,
        lossVerificationEnabled: true,
        lossVerifierId: 'user-1',
      },
    });

    const result = await service.login('gerente@empresa.com', 'senha123');

    expect(result.lossVerificationEnabled).toBe(true);
    expect(result.isLossVerifier).toBe(true);
  });

  it('retorna isLossVerifier=false quando o usuário logado não é o conferente designado', async () => {
    const { service } = makeService({
      company: {
        id: 'company-1',
        status: CompanyStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastManualUnlockAt: null,
        lossVerificationEnabled: true,
        lossVerifierId: 'outro-usuario',
      },
    });

    const result = await service.login('gerente@empresa.com', 'senha123');

    expect(result.isLossVerifier).toBe(false);
  });

  it('MASTER_ADMIN (sem empresa) recebe lossVerificationEnabled=false e isLossVerifier=false', async () => {
    const { service } = makeService({
      lookupRow: {
        id: 'master-1',
        companyId: null,
        passwordHash: 'hash',
        role: UserRole.MASTER_ADMIN,
        isActive: true,
        name: 'Master',
      },
    });

    const result = await service.login('master@sistema.com', 'senha123');

    expect(result.lossVerificationEnabled).toBe(false);
    expect(result.isLossVerifier).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && npx jest auth.service.spec.ts`
Expected: FAIL — `result.lossVerificationEnabled`/`result.isLossVerifier` undefined.

- [ ] **Step 3: Implementar**

Em `backend/src/modules/auth/auth.service.ts`, dentro de `login()`, adicionar duas variáveis `let` junto às já existentes `companyStatus`/`companyDueDate`:

```typescript
    let companyStatus: CompanyStatus | undefined;
    let companyDueDate: Date | null | undefined;
    let lossVerificationEnabled = false;
    let isLossVerifier = false;
```

Dentro do bloco `if (user.role !== UserRole.MASTER_ADMIN && user.companyId) { ... }`, logo após `companyDueDate = company.currentPeriodEnd;`:

```typescript
      lossVerificationEnabled = company.lossVerificationEnabled;
      isLossVerifier = company.lossVerifierId === user.id;
```

No `return` final do método, adicionar os dois campos:

```typescript
    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      },
      companyStatus,
      companyDueDate,
      lossVerificationEnabled,
      isLossVerifier,
    };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && npx jest auth.service.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Rodar a suíte completa do backend, rebuild e verificar via curl**

Run: `cd backend && npm test`
Expected: todos os testes passam.

```bash
cd backend && docker compose build backend && docker compose up -d backend
```

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"gerente.costprice@exemplo.com","password":"senha123"}'
```

Expected: a resposta JSON inclui `"lossVerificationEnabled":false,"isLossVerifier":false` (empresa de teste ainda não ativou a conferência).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/auth.service.spec.ts
git commit -m "feat(backend): login expoe lossVerificationEnabled e isLossVerifier"
```

---

### Task 5: Web-panel — página "Conferências" (configurações + pendências)

**Files:**
- Modify: `web-panel/src/lib/types.ts`
- Create: `web-panel/src/app/(protected)/conferencias/page.tsx`
- Modify: `web-panel/src/components/nav.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /companies/me/settings`, `GET /users`, `GET /losses/pending-verification`, `PATCH /losses/:id/verify`.

- [ ] **Step 1: Adicionar os tipos**

Em `web-panel/src/lib/types.ts`, adicionar (após `SuspiciousPatternEntry`):

```typescript
export interface CompanySettings {
  lossVerificationEnabled: boolean;
  lossVerifierId: string | null;
}
```

- [ ] **Step 2: Criar a página**

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { CompanySettings, Loss, TenantUser } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const NO_VERIFIER = 'none';

export default function ConferenciasPage() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [pending, setPending] = useState<Loss[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [verifierId, setVerifierId] = useState(NO_VERIFIER);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadAll() {
    api
      .get<CompanySettings>('companies/me/settings')
      .then((s) => {
        setSettings(s);
        setEnabled(s.lossVerificationEnabled);
        setVerifierId(s.lossVerifierId ?? NO_VERIFIER);
      })
      .catch((e: ApiError) => setError(e.message));
    api
      .get<TenantUser[]>('users')
      .then(setUsers)
      .catch((e: ApiError) => setError(e.message));
    api
      .get<Loss[]>('losses/pending-verification')
      .then(setPending)
      .catch((e: ApiError) => setError(e.message));
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const updated = await api.patch<CompanySettings>('companies/me/settings', {
        lossVerificationEnabled: enabled,
        lossVerifierId: verifierId === NO_VERIFIER ? null : verifierId,
      });
      setSettings(updated);
    } catch (e) {
      setSettingsError(e instanceof ApiError ? e.message : 'Erro ao salvar configurações.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleConfirm(lossId: string) {
    setConfirmingId(lossId);
    try {
      await api.patch(`losses/${lossId}/verify`);
      setPending((prev) => prev.filter((l) => l.id !== lossId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao confirmar a conferência.');
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-foreground">Conferências</h1>
        <p className="text-sm text-muted-foreground">
          Ative uma segunda validação sobre o que os funcionários descartam.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          <CardDescription>
            Quando ativada, toda perda registrada fica pendente até o conferente confirmar. Mudar esta
            configuração não afeta perdas já registradas.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSaveSettings}>
          <CardContent className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
              Ativar conferência de descarte
            </label>
            <div className="max-w-sm space-y-1.5">
              <Label>Conferente</Label>
              <Select value={verifierId} onValueChange={setVerifierId} disabled={!enabled}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VERIFIER}>Nenhum selecionado</SelectItem>
                  {users
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.role === 'manager' ? 'Gerente' : 'Funcionário'})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {settingsError && <p className="text-sm text-destructive">{settingsError}</p>}
            <Button type="submit" disabled={savingSettings} className="self-start">
              {savingSettings ? 'Salvando...' : 'Salvar configuração'}
            </Button>
          </CardContent>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pendências</CardTitle>
          <CardDescription>Perdas aguardando confirmação do conferente</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nenhuma pendência no momento.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Registrado por</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((loss) => (
                  <TableRow key={loss.id}>
                    <TableCell>{loss.product?.name ?? '—'}</TableCell>
                    <TableCell>{loss.quantity}</TableCell>
                    <TableCell>{loss.reportedBy?.name ?? '—'}</TableCell>
                    <TableCell>{new Date(loss.occurredAt).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => handleConfirm(loss.id)}
                        disabled={confirmingId === loss.id}
                      >
                        {confirmingId === loss.id ? 'Confirmando...' : 'Confirmar'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {settings && (
        <p className="text-xs text-muted-foreground">
          Status atual: <Badge variant={settings.lossVerificationEnabled ? 'default' : 'secondary'}>
            {settings.lossVerificationEnabled ? 'Ativada' : 'Desativada'}
          </Badge>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Adicionar a entrada no menu**

Em `web-panel/src/components/nav.tsx`, adicionar ao array `MANAGER_LINKS` (após o item `Perdas`):

```typescript
  { href: '/conferencias', label: 'Conferências', icon: ShieldCheck },
```

Adicionar `ShieldCheck` ao import de ícones do `lucide-react` já existente no topo do arquivo.

- [ ] **Step 4: Type-check e verificação no navegador**

Run: `cd web-panel && npx tsc --noEmit`
Expected: sem erros.

Com o backend e o web-panel rodando, logar como gerente, abrir `/conferencias`, ativar a conferência, selecionar um conferente, salvar, registrar uma perda (via `/losses` — pelo painel ou um curl autenticado) e confirmar que ela aparece na lista de pendências; clicar "Confirmar" e checar que some da lista.

- [ ] **Step 5: Commit**

```bash
git add web-panel/src/lib/types.ts "web-panel/src/app/(protected)/conferencias" web-panel/src/components/nav.tsx
git commit -m "feat(web-panel): pagina de conferencias (configuracao e pendencias)"
```

---

### Task 6: Mobile — `AuthSession` ganha os campos novos + pop-up no registro (TDD)

**Files:**
- Modify: `mobile_app/lib/data/models/auth_session.dart`
- Create: `mobile_app/test/data/models/auth_session_test.dart`
- Modify: `mobile_app/lib/presentation/screens/loss_form_screen.dart`

**Interfaces:**
- Produces: `AuthSession.lossVerificationEnabled: bool`, `AuthSession.isLossVerifier: bool` (default `false` se ausente — sessões salvas antes desta mudança continuam funcionando).

- [ ] **Step 1: Escrever o teste falho**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/data/models/auth_session.dart';

void main() {
  test('fromApiJson lê lossVerificationEnabled e isLossVerifier do payload de login', () {
    final session = AuthSession.fromApiJson({
      'accessToken': 'token-123',
      'user': {'id': 'user-1', 'name': 'Fulano', 'role': 'employee', 'companyId': 'company-1'},
      'lossVerificationEnabled': true,
      'isLossVerifier': true,
    });

    expect(session.lossVerificationEnabled, true);
    expect(session.isLossVerifier, true);
  });

  test('fromApiJson usa false como padrão quando os campos não vêm no payload', () {
    final session = AuthSession.fromApiJson({
      'accessToken': 'token-123',
      'user': {'id': 'user-1', 'name': 'Fulano', 'role': 'employee', 'companyId': 'company-1'},
    });

    expect(session.lossVerificationEnabled, false);
    expect(session.isLossVerifier, false);
  });

  test('toStorageJson/fromStorageJson preservam os dois campos num round-trip', () {
    final original = AuthSession(
      accessToken: 'token-123',
      userId: 'user-1',
      userName: 'Fulano',
      role: 'manager',
      companyId: 'company-1',
      lossVerificationEnabled: true,
      isLossVerifier: false,
    );

    final restored = AuthSession.fromStorageJson(original.toStorageJson());

    expect(restored.lossVerificationEnabled, true);
    expect(restored.isLossVerifier, false);
  });

  test('fromStorageJson usa false como padrão para sessões salvas antes desta mudança', () {
    final restored = AuthSession.fromStorageJson({
      'accessToken': 'token-123',
      'userId': 'user-1',
      'userName': 'Fulano',
      'role': 'employee',
      'companyId': 'company-1',
    });

    expect(restored.lossVerificationEnabled, false);
    expect(restored.isLossVerifier, false);
  });
}
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd mobile_app && flutter test test/data/models/auth_session_test.dart`
Expected: FAIL — `The named parameter 'lossVerificationEnabled' isn't defined` (o construtor ainda não aceita os campos novos).

- [ ] **Step 3: Implementar**

Substituir o conteúdo de `mobile_app/lib/data/models/auth_session.dart` por:

```dart
class AuthSession {
  final String accessToken;
  final String userId;
  final String userName;
  final String role; // 'manager' | 'employee' | 'master_admin'
  final String? companyId;
  // Conferência de descarte (spec seção 5): capturados no momento do login,
  // guardados junto do resto da sessão — é assim que o app sabe, offline, se
  // deve mostrar o aviso de conferência ao registrar uma perda. Só atualizam
  // no próximo login (não há refresh automático durante a sessão aberta).
  final bool lossVerificationEnabled;
  final bool isLossVerifier;

  AuthSession({
    required this.accessToken,
    required this.userId,
    required this.userName,
    required this.role,
    required this.companyId,
    this.lossVerificationEnabled = false,
    this.isLossVerifier = false,
  });

  factory AuthSession.fromApiJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    return AuthSession(
      accessToken: json['accessToken'] as String,
      userId: user['id'] as String,
      userName: user['name'] as String,
      role: user['role'] as String,
      companyId: user['companyId'] as String?,
      lossVerificationEnabled: json['lossVerificationEnabled'] as bool? ?? false,
      isLossVerifier: json['isLossVerifier'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toStorageJson() => {
        'accessToken': accessToken,
        'userId': userId,
        'userName': userName,
        'role': role,
        'companyId': companyId,
        'lossVerificationEnabled': lossVerificationEnabled,
        'isLossVerifier': isLossVerifier,
      };

  factory AuthSession.fromStorageJson(Map<String, dynamic> json) => AuthSession(
        accessToken: json['accessToken'] as String,
        userId: json['userId'] as String,
        userName: json['userName'] as String,
        role: json['role'] as String,
        companyId: json['companyId'] as String?,
        lossVerificationEnabled: json['lossVerificationEnabled'] as bool? ?? false,
        isLossVerifier: json['isLossVerifier'] as bool? ?? false,
      );
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd mobile_app && flutter test test/data/models/auth_session_test.dart`
Expected: PASS (4 testes).

- [ ] **Step 5: Pop-up no registro de perda**

Em `mobile_app/lib/presentation/screens/loss_form_screen.dart`, adicionar o import:

```dart
import '../../data/models/auth_session.dart';
```

Substituir o final do método `_submit()` (do comentário `// Dispara uma tentativa imediata...` até o fim do método) por:

```dart
    // Dispara uma tentativa imediata (não bloqueia a UI se não houver rede —
    // o SyncQueueService trata isso internamente).
    AppServices.syncQueueService.trySyncPending();

    if (!mounted) return;

    // Lido do AuthSession (capturado no login, spec seção 5) — não é uma
    // chamada de rede, por isso o aviso aparece mesmo offline, no mesmo
    // momento "otimista" que o resto do registro local já usa.
    final AuthSession? session = await AppServices.authRepository.currentSession();
    if (session != null && session.lossVerificationEnabled) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Perda registrada'),
          content: const Text(
            'Esta empresa exige conferência de descarte. O registro foi encaminhado para o conferente confirmar.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                Navigator.of(context).popUntil((route) => route.isFirst);
              },
              child: const Text('Voltar à tela inicial'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                Navigator.of(context).pop(); // fecha o formulário, volta pro Scan
              },
              child: const Text('Registrar nova perda'),
            ),
          ],
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Perda registrada. Será sincronizada automaticamente.')),
    );
    Navigator.of(context)
      ..pop() // fecha o formulário
      ..pop(); // volta para a tela inicial
  }
```

- [ ] **Step 6: Rodar a suíte completa do mobile e analisar**

Run: `cd mobile_app && flutter test`
Expected: todos os testes passam.

Run: `cd mobile_app && flutter analyze`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add mobile_app/lib/data/models/auth_session.dart mobile_app/test/data/models/auth_session_test.dart mobile_app/lib/presentation/screens/loss_form_screen.dart
git commit -m "feat(mobile): AuthSession carrega dados de conferencia; popup no registro de perda"
```

---

### Task 7: Mobile — tela "Conferências pendentes" + entrada na Home (TDD no repositório)

**Files:**
- Create: `mobile_app/lib/data/models/pending_verification_loss.dart`
- Create: `mobile_app/lib/data/repositories/loss_verification_repository.dart`
- Create: `mobile_app/test/data/repositories/loss_verification_repository_test.dart`
- Create: `mobile_app/lib/presentation/screens/pending_verifications_screen.dart`
- Modify: `mobile_app/lib/app_services.dart`
- Modify: `mobile_app/lib/presentation/screens/home_screen.dart`

**Interfaces:**
- Consumes: `ApiClient.get`/`ApiClient.patch` (já existem, sem mudança).
- Produces: `LossVerificationRepository.fetchPending(): Future<List<PendingVerificationLoss>>`, `LossVerificationRepository.confirm(String id): Future<void>`, `AppServices.lossVerificationRepository`.

- [ ] **Step 1: Criar o model**

```dart
class PendingVerificationLoss {
  final String id;
  final String productName;
  final double quantity;
  final String reportedByName;
  final String? description;
  final DateTime occurredAt;

  PendingVerificationLoss({
    required this.id,
    required this.productName,
    required this.quantity,
    required this.reportedByName,
    required this.description,
    required this.occurredAt,
  });

  factory PendingVerificationLoss.fromApiJson(Map<String, dynamic> json) {
    final product = json['product'] as Map<String, dynamic>?;
    final reportedBy = json['reportedBy'] as Map<String, dynamic>?;
    return PendingVerificationLoss(
      id: json['id'] as String,
      productName: product?['name'] as String? ?? 'Produto',
      quantity: double.tryParse(json['quantity'].toString()) ?? 1,
      reportedByName: reportedBy?['name'] as String? ?? 'Funcionário',
      description: json['description'] as String?,
      occurredAt: DateTime.parse(json['occurredAt'] as String),
    );
  }
}
```

- [ ] **Step 2: Escrever o teste falho do repositório**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/core/network/api_client.dart';
import 'package:inventory_loss_app/data/repositories/loss_verification_repository.dart';

class _FakeApiClient extends ApiClient {
  dynamic nextGetResponse;
  String? lastPatchedPath;

  @override
  Future<dynamic> get(String path) async {
    if (path == '/losses/pending-verification') return nextGetResponse;
    throw UnimplementedError('not stubbed: $path');
  }

  @override
  Future<dynamic> patch(String path, Map<String, dynamic> body) async {
    lastPatchedPath = path;
    return {'ok': true};
  }
}

void main() {
  test('fetchPending() busca a lista em GET /losses/pending-verification e converte cada item', () async {
    final apiClient = _FakeApiClient()
      ..nextGetResponse = [
        {
          'id': 'loss-1',
          'quantity': '2.000',
          'description': 'Caiu da prateleira',
          'occurredAt': '2026-09-13T12:00:00.000Z',
          'product': {'name': 'Arroz 5kg'},
          'reportedBy': {'name': 'João Funcionário'},
        },
      ];
    final repository = LossVerificationRepository(apiClient: apiClient);

    final result = await repository.fetchPending();

    expect(result, hasLength(1));
    expect(result.first.productName, 'Arroz 5kg');
    expect(result.first.reportedByName, 'João Funcionário');
    expect(result.first.quantity, 2.0);
  });

  test('confirm() chama PATCH /losses/:id/verify', () async {
    final apiClient = _FakeApiClient();
    final repository = LossVerificationRepository(apiClient: apiClient);

    await repository.confirm('loss-1');

    expect(apiClient.lastPatchedPath, '/losses/loss-1/verify');
  });
}
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `cd mobile_app && flutter test test/data/repositories/loss_verification_repository_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:inventory_loss_app/data/repositories/loss_verification_repository.dart'`.

- [ ] **Step 4: Implementar o repositório**

```dart
import '../../core/network/api_client.dart';
import '../models/pending_verification_loss.dart';

/// Conferência de descarte (spec seção 5) — sempre busca ao vivo do servidor,
/// nunca cacheado localmente (a lista depende de registros de outros
/// funcionários, não faz sentido guardar offline).
class LossVerificationRepository {
  final ApiClient _apiClient;

  LossVerificationRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  Future<List<PendingVerificationLoss>> fetchPending() async {
    final json = await _apiClient.get('/losses/pending-verification');
    return (json as List)
        .map((e) => PendingVerificationLoss.fromApiJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> confirm(String lossId) {
    return _apiClient.patch('/losses/$lossId/verify', {});
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `cd mobile_app && flutter test test/data/repositories/loss_verification_repository_test.dart`
Expected: PASS (2 testes).

- [ ] **Step 6: Registrar em `AppServices`**

Em `mobile_app/lib/app_services.dart`, adicionar o import:

```dart
import 'data/repositories/loss_verification_repository.dart';
```

E o campo estático, junto aos demais:

```dart
  static final LossVerificationRepository lossVerificationRepository =
      LossVerificationRepository(apiClient: apiClient);
```

- [ ] **Step 7: Criar a tela**

```dart
import 'package:flutter/material.dart';
import '../../app_services.dart';
import '../../data/models/pending_verification_loss.dart';

/// Conferência de descarte (spec seção 5) — acessível só para quem é o
/// conferente designado da empresa ou tem papel MANAGER (ver home_screen.dart).
class PendingVerificationsScreen extends StatefulWidget {
  const PendingVerificationsScreen({super.key});

  @override
  State<PendingVerificationsScreen> createState() => _PendingVerificationsScreenState();
}

class _PendingVerificationsScreenState extends State<PendingVerificationsScreen> {
  late Future<List<PendingVerificationLoss>> _future;
  final Set<String> _confirming = {};

  @override
  void initState() {
    super.initState();
    _future = AppServices.lossVerificationRepository.fetchPending();
  }

  Future<void> _confirm(PendingVerificationLoss loss, List<PendingVerificationLoss> current) async {
    setState(() => _confirming.add(loss.id));
    try {
      await AppServices.lossVerificationRepository.confirm(loss.id);
      if (!mounted) return;
      setState(() {
        current.removeWhere((l) => l.id == loss.id);
        _confirming.remove(loss.id);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _confirming.remove(loss.id));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível confirmar. Tente novamente.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Conferências pendentes')),
      body: FutureBuilder<List<PendingVerificationLoss>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Não foi possível carregar as conferências pendentes.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          final losses = snapshot.data!;
          if (losses.isEmpty) {
            return const Center(child: Text('Nenhuma perda pendente de conferência.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: losses.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final loss = losses[index];
              final confirming = _confirming.contains(loss.id);
              final hasDescription = loss.description != null && loss.description!.isNotEmpty;
              return Card(
                child: ListTile(
                  title: Text(loss.productName),
                  subtitle: Text(
                    'Qtd: ${loss.quantity.toStringAsFixed(0)} · ${loss.reportedByName}'
                    '${hasDescription ? '\n${loss.description}' : ''}',
                  ),
                  isThreeLine: hasDescription,
                  trailing: FilledButton(
                    onPressed: confirming ? null : () => _confirm(loss, losses),
                    child: confirming
                        ? const SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Confirmar'),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 8: Adicionar a entrada condicional na Home**

Em `mobile_app/lib/presentation/screens/home_screen.dart`, adicionar os imports:

```dart
import '../../data/models/auth_session.dart';
import 'pending_verifications_screen.dart';
```

Adicionar o campo de estado, junto a `bool _refreshingCatalog = false;`:

```dart
  AuthSession? _session;
```

No `initState()`, adicionar a chamada (mantendo o listener já existente):

```dart
  @override
  void initState() {
    super.initState();
    AppServices.syncQueueService.addListener(_onSyncStateChanged);
    _loadSession();
  }

  Future<void> _loadSession() async {
    final session = await AppServices.authRepository.currentSession();
    if (!mounted) return;
    setState(() => _session = session);
  }
```

No `build()`, adicionar o botão condicional logo após o bloco do botão "Atualizar produtos" (antes do `if (pending + errors > 0) ...`):

```dart
              if (_session != null && (_session!.role == 'manager' || _session!.isLossVerifier)) ...[
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const PendingVerificationsScreen()),
                  ),
                  icon: const Icon(Icons.fact_check_outlined),
                  label: const Text('Conferências pendentes'),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                ),
              ],
```

- [ ] **Step 9: Rodar a suíte completa do mobile e analisar**

Run: `cd mobile_app && flutter test`
Expected: todos os testes passam.

Run: `cd mobile_app && flutter analyze`
Expected: sem erros novos (avisos pré-existentes não relacionados a este código são aceitáveis).

- [ ] **Step 10: Commit**

```bash
git add mobile_app/lib/data/models/pending_verification_loss.dart mobile_app/lib/data/repositories/loss_verification_repository.dart mobile_app/test/data/repositories/loss_verification_repository_test.dart mobile_app/lib/presentation/screens/pending_verifications_screen.dart mobile_app/lib/app_services.dart mobile_app/lib/presentation/screens/home_screen.dart
git commit -m "feat(mobile): tela de conferencias pendentes e entrada condicional na Home"
```

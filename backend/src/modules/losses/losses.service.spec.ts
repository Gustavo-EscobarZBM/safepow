import { Loss } from './loss.entity';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { tenantStorage } from '../../common/tenant/tenant-storage';
import { UserRole } from '../users/user.entity';
import { LossesService } from './losses.service';

const CLIENT_GENERATED_ID = '550e8400-e29b-41d4-a716-446655440000';
const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440001';
const LOCATION_ID = '550e8400-e29b-41d4-a716-446655440002';
const REASON_ID = '550e8400-e29b-41d4-a716-446655440003';
const COMPANY_ID = 'company-1';

function runWithTenantContext<T>(manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run(
    { userId: 'user-1', role: UserRole.EMPLOYEE, companyId: COMPANY_ID, manager },
    fn,
  );
}

describe('LossesService.create (idempotência offline — Seção 4.2)', () => {
  it('cria um novo registro quando o clientGeneratedId ainda não existe', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'loss-1', ...data })),
    };
    // Ordem das chamadas a findOne: loss existente (null), produto, motivo, local.
    manager.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: PRODUCT_ID, name: 'Arroz 5kg' })
      .mockResolvedValueOnce({ id: REASON_ID, name: 'Quebra/Avaria' })
      .mockResolvedValueOnce({ id: LOCATION_ID, name: 'Depósito/Estoque' });

    const service = new LossesService();

    const result = await runWithTenantContext(manager, () =>
      service.create({
        clientGeneratedId: CLIENT_GENERATED_ID,
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        reasonId: REASON_ID,
        description: 'Caiu da prateleira',
        occurredAt: new Date().toISOString(),
      }),
    );

    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(result.clientGeneratedId).toBe(CLIENT_GENERATED_ID);
  });

  it('devolve o registro existente em vez de duplicar quando o app reenvia o mesmo clientGeneratedId', async () => {
    const existingLoss = {
      id: 'loss-1',
      clientGeneratedId: CLIENT_GENERATED_ID,
      companyId: COMPANY_ID,
      productId: PRODUCT_ID,
    };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest.fn().mockResolvedValue(existingLoss),
      create: jest.fn(),
      save: jest.fn(),
    };

    const service = new LossesService();

    const result = await runWithTenantContext(manager, () =>
      service.create({
        clientGeneratedId: CLIENT_GENERATED_ID,
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        reasonId: REASON_ID,
        description: 'Reenvio após queda de conexão',
        occurredAt: new Date().toISOString(),
      }),
    );

    // O ponto central do teste: NUNCA grava de novo — só devolve o que já existia.
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.create).not.toHaveBeenCalled();
    expect(result).toBe(existingLoss);
  });

  it('lança NotFoundException quando o produto informado não existe na empresa', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      create: jest.fn(),
      save: jest.fn(),
    };

    const service = new LossesService();

    await expect(
      runWithTenantContext(manager, () =>
        service.create({
          clientGeneratedId: CLIENT_GENERATED_ID,
          productId: 'produto-que-nao-existe',
          locationId: LOCATION_ID,
          reasonId: REASON_ID,
          description: 'Teste',
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lança NotFoundException quando o motivo informado não existe na empresa', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null) // loss existente
        .mockResolvedValueOnce({ id: PRODUCT_ID }) // produto
        .mockResolvedValueOnce(null), // motivo não encontrado
      create: jest.fn(),
      save: jest.fn(),
    };

    const service = new LossesService();

    await expect(
      runWithTenantContext(manager, () =>
        service.create({
          clientGeneratedId: CLIENT_GENERATED_ID,
          productId: PRODUCT_ID,
          locationId: LOCATION_ID,
          reasonId: 'motivo-que-nao-existe',
          description: 'Teste',
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lança NotFoundException quando o local informado não existe na empresa', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null) // loss existente
        .mockResolvedValueOnce({ id: PRODUCT_ID }) // produto
        .mockResolvedValueOnce({ id: REASON_ID }) // motivo
        .mockResolvedValueOnce(null), // local não encontrado
      create: jest.fn(),
      save: jest.fn(),
    };

    const service = new LossesService();

    await expect(
      runWithTenantContext(manager, () =>
        service.create({
          clientGeneratedId: CLIENT_GENERATED_ID,
          productId: PRODUCT_ID,
          locationId: 'local-que-nao-existe',
          reasonId: REASON_ID,
          description: 'Teste',
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('grava requiresVerification=true quando a empresa tem a conferência de descarte ativada', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
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
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
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
});

function runAs<T>(role: UserRole, userId: string, manager: any, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ userId, role, companyId: COMPANY_ID, manager }, fn);
}

describe('LossesService.findPendingVerification / verify (conferência de descarte)', () => {
  it('MANAGER pode listar as pendências de conferência', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]), find: jest.fn().mockResolvedValue([{ id: 'loss-1' }]) };
    const service = new LossesService();

    const result = await runAs(UserRole.MANAGER, 'manager-1', manager, () => service.findPendingVerification());

    expect(result).toEqual([{ id: 'loss-1' }]);
  });

  it('o funcionário designado como conferente pode listar as pendências', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
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
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
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
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest.fn().mockResolvedValue(loss),
      save: jest.fn().mockImplementation((l) => Promise.resolve(l)),
    };
    const service = new LossesService();

    const result = await runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('loss-1'));

    expect(result.verifiedByUserId).toBe('manager-1');
    expect(result.verifiedAt).toBeInstanceOf(Date);
  });

  it('verify lança NotFoundException quando a perda não existe', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]), findOne: jest.fn().mockResolvedValue(null) };
    const service = new LossesService();

    await expect(
      runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('id-invalido')),
    ).rejects.toThrow(NotFoundException);
  });

  it('verify lança ConflictException quando a perda já foi conferida', async () => {
    const loss = { id: 'loss-1', requiresVerification: true, verifiedAt: new Date() };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]), findOne: jest.fn().mockResolvedValue(loss) };
    const service = new LossesService();

    await expect(runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('loss-1'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('verify lança BadRequestException quando a perda não requer conferência', async () => {
    const loss = { id: 'loss-1', requiresVerification: false, verifiedAt: null };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]), findOne: jest.fn().mockResolvedValue(loss) };
    const service = new LossesService();

    await expect(runAs(UserRole.MANAGER, 'manager-1', manager, () => service.verify('loss-1'))).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('LossesService — valor congelado (SP1, sub-etapa 1.2.3)', () => {
  const OCCURRED_AT = '2026-09-10T15:00:00.000Z';

  it('create grava o preço vigente em occurredAt (não o preço atual do produto)', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'loss-1', ...data })),
    };
    // Ordem: loss existente (null), produto, motivo, local, empresa, linha vigente do histórico.
    manager.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: PRODUCT_ID, name: 'Arroz 5kg', unitPrice: '30.00', costPrice: '20.00' })
      .mockResolvedValueOnce({ id: REASON_ID })
      .mockResolvedValueOnce({ id: LOCATION_ID })
      .mockResolvedValueOnce({ id: COMPANY_ID, lossVerificationEnabled: false })
      .mockResolvedValueOnce({ unitPrice: '25.00', costPrice: '15.00' });

    const result = await runWithTenantContext(manager, () =>
      new LossesService().create({
        clientGeneratedId: CLIENT_GENERATED_ID,
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        reasonId: REASON_ID,
        occurredAt: OCCURRED_AT,
      }),
    );

    expect(result).toMatchObject({ unitPriceAtLoss: 25, unitCostAtLoss: 15, valuationSource: 'snapshot' });
    // A consulta ao histórico usou occurredAt — não "agora".
    const historyQuery = manager.findOne.mock.calls[5][1];
    expect(historyQuery.where.validFrom.value).toEqual(new Date(OCCURRED_AT));
  });

  it('update que muda só quantidade/descrição NÃO recalcula o valor congelado', async () => {
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      quantity: 1,
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest.fn().mockResolvedValueOnce(loss),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { quantity: 3, description: 'Corrigido' }),
    );

    expect(manager.findOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ quantity: 3, unitPriceAtLoss: 25, unitCostAtLoss: 15 });
  });

  it('update com os MESMOS productId/occurredAt (formulário reenviando tudo) NÃO recalcula', async () => {
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        .mockResolvedValueOnce({ id: PRODUCT_ID, unitPrice: '99.00', costPrice: '88.00' }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { productId: PRODUCT_ID, occurredAt: OCCURRED_AT }),
    );

    // 1ª chamada: a perda; 2ª: validação do produto informado. Nenhuma consulta ao histórico.
    expect(manager.findOne).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ unitPriceAtLoss: 25, unitCostAtLoss: 15, valuationSource: 'snapshot' });
  });

  it('update com occurredAt truncado no minuto (datetime-local do painel) é eco do valor atual: não recalcula nem mexe na data', async () => {
    // Perda do app: DateTime.now() tem segundos e milissegundos; o <input type="datetime-local"> do
    // painel devolve a mesma data cortada no minuto, mesmo quando o gerente só trocou o motivo.
    const original = new Date('2026-09-10T15:00:45.123Z');
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: original,
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'backfill_current',
    };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        .mockResolvedValueOnce({ id: REASON_ID }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { reasonId: REASON_ID, occurredAt: '2026-09-10T15:00:00.000Z' }),
    );

    // 1ª chamada: a perda; 2ª: validação do motivo. Nenhuma consulta de produto/histórico.
    expect(manager.findOne).toHaveBeenCalledTimes(2);
    expect((result as Loss).occurredAt).toEqual(original);
    expect(result).toMatchObject({ unitPriceAtLoss: 25, unitCostAtLoss: 15, valuationSource: 'backfill_current' });
  });

  it('update com occurredAt em OUTRO minuto recalcula normalmente, mesmo vindo truncado', async () => {
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date('2026-09-10T15:00:45.123Z'),
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        .mockResolvedValueOnce({ id: PRODUCT_ID, unitPrice: '99.00', costPrice: '88.00' })
        .mockResolvedValueOnce({ unitPrice: '18.00', costPrice: '9.00' }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { occurredAt: '2026-09-10T15:01:00.000Z' }),
    );

    expect((result as Loss).occurredAt).toEqual(new Date('2026-09-10T15:01:00.000Z'));
    expect(result).toMatchObject({ unitPriceAtLoss: 18, unitCostAtLoss: 9 });
  });

  it('update que muda occurredAt recalcula com o preço vigente na nova data', async () => {
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        // produto (carregado para o cálculo), depois a linha vigente na nova data
        .mockResolvedValueOnce({ id: PRODUCT_ID, unitPrice: '99.00', costPrice: '88.00' })
        .mockResolvedValueOnce({ unitPrice: '18.00', costPrice: '9.00' }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { occurredAt: '2026-08-01T10:00:00.000Z' }),
    );

    expect(result).toMatchObject({ unitPriceAtLoss: 18, unitCostAtLoss: 9, valuationSource: 'snapshot' });
  });

  it('update que muda o produto recalcula com o histórico do produto novo', async () => {
    const OTHER_PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440009';
    const loss = {
      id: 'loss-1',
      productId: PRODUCT_ID,
      occurredAt: new Date(OCCURRED_AT),
      unitPriceAtLoss: 25,
      unitCostAtLoss: 15,
      valuationSource: 'snapshot',
    };
    const manager = { query: jest.fn().mockResolvedValue([{ approvalPolicies: {} }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(loss)
        .mockResolvedValueOnce({ id: OTHER_PRODUCT_ID, unitPrice: '7.00', costPrice: '3.00' })
        .mockResolvedValueOnce({ unitPrice: '6.50', costPrice: '2.50' }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const result = await runWithTenantContext(manager, () =>
      new LossesService().update('loss-1', { productId: OTHER_PRODUCT_ID }),
    );

    expect(result).toMatchObject({ productId: OTHER_PRODUCT_ID, unitPriceAtLoss: 6.5, unitCostAtLoss: 2.5 });
  });
});

import { NotFoundException } from '@nestjs/common';
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
    const manager = {
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
    const manager = {
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
    const manager = {
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
    const manager = {
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
    const manager = {
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
});

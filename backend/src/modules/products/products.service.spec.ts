import { ConflictException, NotFoundException } from '@nestjs/common';
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

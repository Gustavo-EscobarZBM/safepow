import { BadRequestException } from '@nestjs/common';
import { getImportHandler } from './index';
import { ExistingProduct, productsImportHandler as handler } from './products.import-handler';

const existing = (over: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: 'p1',
  barcode: '1',
  name: 'Arroz',
  sku: null,
  unitPrice: 10,
  costPrice: 6,
  isActive: true,
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

const ALL = ['barcode', 'name', 'sku', 'unitPrice', 'costPrice'];
const ctx = (over: Partial<{ mappedFields: string[]; updateFields: string[]; priceThresholdPercent: number | null }> = {}) => ({
  mappedFields: ALL,
  updateFields: ['name', 'sku', 'unitPrice', 'costPrice'],
  priceThresholdPercent: null,
  ...over,
});

describe('productsImportHandler — campos', () => {
  it('chaves, obrigatórios e atualizáveis', () => {
    expect(handler.fields.map((f) => f.key)).toEqual(['barcode', 'name', 'sku', 'unitPrice', 'costPrice']);
    expect(handler.fields.filter((f) => f.required).map((f) => f.key)).toEqual(['barcode', 'name']);
    expect(handler.fields.filter((f) => !f.updatable).map((f) => f.key)).toEqual(['barcode']);
    expect(handler.keyField).toBe('barcode');
    expect(handler.resource).toBe('products');
  });
  it('rótulos em português', () => {
    expect(handler.fields.map((f) => f.label)).toEqual(['Código de barras', 'Nome', 'SKU', 'Preço de venda', 'Custo']);
  });
});

describe('productsImportHandler.plan', () => {
  it('sem existente ⇒ create com os campos mapeados (preço não informado vira 0)', () => {
    const plan = handler.plan({ barcode: '9', name: 'Feijão', unitPrice: null }, undefined, ctx({ mappedFields: ['barcode', 'name', 'unitPrice'] }));
    expect(plan).toEqual({
      action: 'create',
      diff: { name: { from: null, to: 'Feijão' }, unitPrice: { from: null, to: 0 } },
      warnings: [],
      sensitivePrice: false,
    });
  });

  it('só campos de updateFields contam: nome diferente fora da lista ⇒ unchanged', () => {
    const plan = handler.plan({ barcode: '1', name: 'Outro', unitPrice: 10 }, existing(), ctx({ updateFields: ['unitPrice'] }));
    expect(plan.action).toBe('unchanged');
    expect(plan.diff).toBeNull();
  });

  it('preço diferente ⇒ update com diff só do preço', () => {
    const plan = handler.plan({ barcode: '1', name: 'Outro', unitPrice: 12 }, existing(), ctx({ updateFields: ['unitPrice'] }));
    expect(plan.action).toBe('update');
    expect(plan.diff).toEqual({ unitPrice: { from: 10, to: 12 } });
  });

  it('arquivado ⇒ reactivate mesmo sem diferença', () => {
    const plan = handler.plan({ barcode: '1', name: 'Arroz', unitPrice: 10 }, existing({ isActive: false }), ctx());
    expect(plan.action).toBe('reactivate');
    expect(plan.diff).toEqual({ isActive: { from: false, to: true } });
  });

  it('valor não informado (null) não entra no diff', () => {
    const plan = handler.plan({ barcode: '1', name: 'Arroz', unitPrice: null, costPrice: null, sku: null }, existing(), ctx());
    expect(plan.action).toBe('unchanged');
  });

  it.each<[number, number, boolean]>([
    [10, 15, true],
    [10, 0, true],
    [10, 14.99, false],
  ])('aviso PRICE_JUMP: %d ⇒ %d = %p', (from, to, warned) => {
    const plan = handler.plan({ barcode: '1', name: 'Arroz', unitPrice: to }, existing({ unitPrice: from, costPrice: 0 }), ctx());
    expect(plan.warnings.includes('PRICE_JUMP')).toBe(warned);
  });

  it('0 ⇒ 5 não é salto', () => {
    const plan = handler.plan({ barcode: '1', name: 'Arroz', unitPrice: 5 }, existing({ unitPrice: 0, costPrice: 0 }), ctx());
    expect(plan.warnings).toEqual([]);
  });

  it('COST_ABOVE_PRICE, inclusive com o custo vindo do produto existente', () => {
    expect(handler.plan({ barcode: '9', name: 'X', unitPrice: 10, costPrice: 12 }, undefined, ctx()).warnings).toEqual(['COST_ABOVE_PRICE']);
    const plan = handler.plan(
      { barcode: '1', name: 'Arroz', unitPrice: 5 },
      existing({ unitPrice: 5.5, costPrice: 6 }),
      ctx({ mappedFields: ['barcode', 'name', 'unitPrice'] }),
    );
    expect(plan.warnings).toEqual(['COST_ABOVE_PRICE']);
  });

  it('sensitivePrice segue a política (limite 20%)', () => {
    const values = { barcode: '1', name: 'Arroz', unitPrice: 13 };
    expect(handler.plan(values, existing(), ctx({ priceThresholdPercent: 20 })).sensitivePrice).toBe(true);
    expect(handler.plan(values, existing(), ctx({ priceThresholdPercent: null })).sensitivePrice).toBe(false);
    expect(handler.plan(values, existing(), ctx({ priceThresholdPercent: 20, updateFields: ['name'] })).sensitivePrice).toBe(false);
  });
});

describe('getImportHandler', () => {
  it('products', () => expect(getImportHandler('products')).toBe(handler));
  it('desconhecido ⇒ 400', () => {
    expect(() => getImportHandler('users')).toThrow(BadRequestException);
    expect(() => getImportHandler('users')).toThrow('Tipo de importação desconhecido.');
  });
});

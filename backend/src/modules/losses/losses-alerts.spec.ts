import { Loss } from './loss.entity';
import { AlertsInput, computeLossAlerts } from './losses-alerts';

let idCounter = 0;

/** Perda mínima para as regras de valor. `catalogPrice` = preço do cadastro HOJE (diferente de propósito). */
function makeLoss(overrides: { productId: string; productName: string; unitPriceAtLoss: number; catalogPrice: number }): Loss {
  idCounter += 1;
  return {
    id: `loss-${idCounter}`,
    companyId: 'company-1',
    productId: overrides.productId,
    product: { id: overrides.productId, name: overrides.productName, unitPrice: overrides.catalogPrice, isActive: true },
    reportedByUserId: 'emp-1',
    reportedBy: { id: 'emp-1', name: 'Funcionário' },
    quantity: 1,
    locationId: 'loc-1',
    location: { id: 'loc-1', name: 'Local 1' },
    reasonId: 'reason-1',
    reason: { id: 'reason-1', name: 'Quebra' },
    description: 'Descrição detalhada o suficiente',
    imageUrl: 'https://example.com/foto.jpg',
    unitPriceAtLoss: overrides.unitPriceAtLoss,
    unitCostAtLoss: 0,
    valuationSource: 'snapshot',
    occurredAt: new Date(),
    createdAt: new Date(),
  } as unknown as Loss;
}

function input(currentLosses: Loss[]): AlertsInput {
  return {
    currentLosses,
    previousLosses: [],
    monthSummary: {
      currentMonth: { totalQuantity: 0, totalFinancialLoss: 0 },
      previousMonth: { totalQuantity: 0, totalFinancialLoss: 0 },
      financialVariationPercent: null,
    },
    activeEmployeeCount: 0,
    recentTop3ByMonth: [[], [], []],
    now: new Date(),
  };
}

describe('computeLossAlerts — regras de valor usam o valor congelado da perda', () => {
  it('concentração por produto pesa pelo valor da época, não pelo preço atual do cadastro', () => {
    const losses = [
      // A valia 100 quando foi perdido (hoje custa 1); B valia 1 (hoje custa 100).
      makeLoss({ productId: 'A', productName: 'Produto A', unitPriceAtLoss: 100, catalogPrice: 1 }),
      makeLoss({ productId: 'B', productName: 'Produto B', unitPriceAtLoss: 1, catalogPrice: 100 }),
    ];
    const alert = computeLossAlerts(input(losses)).find((a) => a.id === 'product_concentration');
    expect(alert?.description).toContain('"Produto A"');
  });

  it('preço zero: dispara quando a perda foi registrada com valor zero, mesmo que o cadastro já tenha preço', () => {
    const losses = [makeLoss({ productId: 'Z', productName: 'Sem Preço', unitPriceAtLoss: 0, catalogPrice: 50 })];
    expect(computeLossAlerts(input(losses)).some((a) => a.id === 'zero_price_product')).toBe(true);
  });

  it('preço zero: NÃO dispara quando a perda tem valor, mesmo que o cadastro esteja zerado hoje', () => {
    const losses = [makeLoss({ productId: 'P', productName: 'Com Preço', unitPriceAtLoss: 10, catalogPrice: 0 })];
    expect(computeLossAlerts(input(losses)).some((a) => a.id === 'zero_price_product')).toBe(false);
  });
});

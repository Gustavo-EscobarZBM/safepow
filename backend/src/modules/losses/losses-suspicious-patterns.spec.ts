import { Loss } from './loss.entity';
import { computeSuspiciousPatterns } from './losses-suspicious-patterns';

let idCounter = 0;

function makeLoss(overrides: Partial<{
  reportedByUserId: string;
  reportedByName: string;
  productId: string;
  productName: string;
  unitPrice: number;
  reasonId: string;
  reasonName: string;
  quantity: number;
  description: string | null;
  imageUrl: string | null;
  occurredAt: Date;
}> = {}): Loss {
  idCounter += 1;
  const n = idCounter;
  const {
    reportedByUserId = 'emp-1',
    reportedByName = 'Funcionário',
    productId = `prod-${n}`,
    productName = `Produto ${n}`,
    unitPrice = 10,
    reasonId = `reason-${n}`,
    reasonName = `Motivo ${n}`,
    quantity = 1,
    description = 'Descrição detalhada o suficiente para não contar como pobre',
    imageUrl = 'https://example.com/foto.jpg',
    occurredAt = new Date(),
  } = overrides;

  return {
    id: `loss-${n}`,
    companyId: 'company-1',
    company: undefined,
    clientGeneratedId: `cgid-${n}`,
    productId,
    // O preço do CADASTRO hoje é diferente de propósito (0): o cálculo tem de usar o valor congelado da
    // perda (unitPriceAtLoss), nunca o preço atual do produto (F1).
    product: { id: productId, name: productName, unitPrice: 0 } as Loss['product'],
    unitPriceAtLoss: unitPrice,
    unitCostAtLoss: 0,
    valuationSource: 'snapshot',
    reportedByUserId,
    reportedBy: { id: reportedByUserId, name: reportedByName } as Loss['reportedBy'],
    quantity,
    locationId: 'loc-1',
    location: { id: 'loc-1', name: 'Local 1' } as Loss['location'],
    reasonId,
    reason: { id: reasonId, name: reasonName } as Loss['reason'],
    description,
    source: null,
    imageUrl,
    occurredAt,
    createdAt: new Date(),
  } as unknown as Loss;
}

describe('computeSuspiciousPatterns', () => {
  it('ignora funcionários com menos de 3 perdas no período (amostra mínima)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 1000 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 1000 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    expect(result).toEqual([]);
  });

  it('sinal 1: concentração de valor no funcionário (peso 20)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 30 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 30 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 30 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.score).toBe(20);
    expect(emp1.reasons.some((r) => r.includes('prejuízo total da empresa'))).toBe(true);
  });

  it('sinal 2: produto de alto valor recorrente (peso 20)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', productId: 'prod-caro', productName: 'Notebook', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'prod-caro', productName: 'Notebook', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'prod-caro', productName: 'Notebook', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Notebook'))).toBe(true);
  });

  it('sinal 3: motivo sempre igual (peso 10)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-furto', reasonName: 'Furto' }),
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-furto', reasonName: 'Furto' }),
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-furto', reasonName: 'Furto' }),
      makeLoss({ reportedByUserId: 'emp-1', reasonId: 'r-quebra', reasonName: 'Quebra' }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Furto'))).toBe(true);
  });

  it('sinal 4: mesma combinação produto+motivo repetida (peso 10)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p1', productName: 'Vinho', reasonId: 'r1', reasonName: 'Quebra' }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p1', productName: 'Vinho', reasonId: 'r1', reasonName: 'Quebra' }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p1', productName: 'Vinho', reasonId: 'r1', reasonName: 'Quebra' }),
      makeLoss({ reportedByUserId: 'emp-1', productId: 'p2', productName: 'Suco', reasonId: 'r2', reasonName: 'Furto' }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Vinho') && r.includes('Quebra'))).toBe(true);
  });

  it('sinal 5: quantidade média muito acima da empresa (peso 10)', () => {
    // A média da empresa inclui as próprias perdas do emp-1, então é preciso
    // bastante "ruído" de baixa quantidade dos outros funcionários pra não
    // diluir a média geral pra perto da do emp-1 (com poucos registros, o
    // emp-1 sozinho já é boa parte da amostra).
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', quantity: 20 }),
      makeLoss({ reportedByUserId: 'emp-1', quantity: 20 }),
      makeLoss({ reportedByUserId: 'emp-1', quantity: 20 }),
      ...Array.from({ length: 10 }, () => makeLoss({ reportedByUserId: 'emp-2', quantity: 1 })),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('Quantidade média'))).toBe(true);
  });

  it('sinal 6: tendência de alta pessoal (peso 10)', () => {
    const currentLosses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 100 }),
    ];
    const previousLosses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses, previousLosses });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('dobrou'))).toBe(true);
  });

  it('sinal 7: ausência de foto (peso 15)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', imageUrl: null }),
      makeLoss({ reportedByUserId: 'emp-1', imageUrl: null }),
      makeLoss({ reportedByUserId: 'emp-1', imageUrl: null }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('sem foto'))).toBe(true);
  });

  it('sinal 8: descrição pobre (peso 15)', () => {
    const losses = [
      makeLoss({ reportedByUserId: 'emp-1', description: 'curta' }),
      makeLoss({ reportedByUserId: 'emp-1', description: 'curta' }),
      makeLoss({ reportedByUserId: 'emp-1', description: 'curta' }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.reasons.some((r) => r.includes('descrição muito curta'))).toBe(true);
  });

  it('nunca ultrapassa 100 mesmo quando todos os sinais disparam juntos', () => {
    const currentLosses = [
      makeLoss({
        reportedByUserId: 'emp-1',
        productId: 'p-caro',
        productName: 'Caro',
        reasonId: 'r1',
        reasonName: 'Furto',
        unitPrice: 1000,
        quantity: 50,
        description: 'x',
        imageUrl: null,
      }),
      makeLoss({
        reportedByUserId: 'emp-1',
        productId: 'p-caro',
        productName: 'Caro',
        reasonId: 'r1',
        reasonName: 'Furto',
        unitPrice: 1000,
        quantity: 50,
        description: 'x',
        imageUrl: null,
      }),
      makeLoss({
        reportedByUserId: 'emp-1',
        productId: 'p-caro',
        productName: 'Caro',
        reasonId: 'r1',
        reasonName: 'Furto',
        unitPrice: 1000,
        quantity: 50,
        description: 'x',
        imageUrl: null,
      }),
      // "Ruído" de outros funcionários com quantidade baixa — sem isso, o
      // emp-1 sozinho dominaria a média geral e o sinal 5 não dispararia.
      ...Array.from({ length: 5 }, () => makeLoss({ reportedByUserId: 'emp-2', unitPrice: 5, quantity: 1 })),
    ];
    const previousLosses = [
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10, quantity: 1 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10, quantity: 1 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 10, quantity: 1 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses, previousLosses });
    const emp1 = result.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.score).toBeLessThanOrEqual(100);
    expect(emp1.score).toBe(100);
  });

  it('ordena por score decrescente e omite quem tem score zero', () => {
    const losses = [
      // emp-1: dispara concentração de valor (score alto)
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 500 }),
      makeLoss({ reportedByUserId: 'emp-1', unitPrice: 500 }),
      // emp-2: perdas normais, nenhum sinal dispara
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
      makeLoss({ reportedByUserId: 'emp-2', unitPrice: 10 }),
    ];
    const result = computeSuspiciousPatterns({ currentLosses: losses, previousLosses: [] });
    expect(result.map((r) => r.employeeId)).toEqual(['emp-1']);
  });
});

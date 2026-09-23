import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../../test-utils/test-db';
import { ProductsService } from '../products/products.service';
import { UserRole } from '../users/user.entity';
import { LossesService } from './losses.service';

/**
 * F1 (desenho mestre): mudar o preço do produto reescrevia o valor de TODAS as perdas antigas em todo
 * relatório. Registra uma perda de 2 unidades a R$ 25,00, muda o preço para R$ 100,00 e confere que o
 * prejuízo continua R$ 50,00 no resumo do mês, no relatório por produto, nas composições e no xlsx.
 */
describe('regressão F1 — mudar o preço não reescreve perdas antigas', () => {
  let companyId: string;
  let productId: string;
  let managerId: string;

  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa F1');
    productId = await seedProduct({ companyId, barcode: '7001', unitPrice: 25, costPrice: 15 });
    managerId = (
      await adminQuery(
        `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ('Gerente F1', 'gerente-f1@teste.local', 'x', 'manager', $1) RETURNING id`,
        [companyId],
      )
    )[0].id;
    const locationId = (
      await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito') RETURNING id`, [companyId])
    )[0].id;
    const reasonId = (
      await adminQuery(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, 'Quebra') RETURNING id`, [companyId])
    )[0].id;

    const ctx = { companyId, userId: managerId, role: UserRole.MANAGER };
    await withTenant(ctx, () =>
      new LossesService().create({
        clientGeneratedId: randomUUID(),
        productId,
        locationId,
        reasonId,
        quantity: 2,
        occurredAt: new Date().toISOString(),
      }),
    );
    await withTenant(ctx, () => new ProductsService().update(productId, { unitPrice: 100, costPrice: 60 }));
  });
  afterAll(() => closeTestConnections());

  const ctx = () => ({ companyId, userId: managerId, role: UserRole.MANAGER });

  it('reportSummary mantém o prejuízo do mês', async () => {
    const summary = await withTenant(ctx(), () => new LossesService().reportSummary());
    expect(summary.currentMonth.totalFinancialLoss).toBe(50);
    expect(summary.currentMonth.totalCostLoss).toBe(30);
  });

  it('reportByProduct mantém o prejuízo do produto', async () => {
    const [row] = await withTenant(ctx(), () => new LossesService().reportByProduct({}));
    expect(Number(row.totalFinancialLoss)).toBe(50);
    expect(Number(row.totalCostLoss)).toBe(30);
  });

  it('reportByReason, reportByLocation e reportByPeriod mantêm o prejuízo', async () => {
    const service = new LossesService();
    const [byReason] = await withTenant(ctx(), () => service.reportByReason({}));
    const [byLocation] = await withTenant(ctx(), () => service.reportByLocation({}));
    const [byPeriod] = await withTenant(ctx(), () => service.reportByPeriod({}));
    expect(Number(byReason.totalFinancialLoss)).toBe(50);
    expect(Number(byLocation.totalFinancialLoss)).toBe(50);
    expect(Number(byPeriod.totalFinancialLoss)).toBe(50);
  });

  it('o export xlsx mostra o preço e o prejuízo da época da perda', async () => {
    const buffer = await withTenant(ctx(), () => new LossesService().exportToXlsx({}));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const row = workbook.worksheets[0].getRow(2);
    expect(row.getCell(5).value).toBe(25); // Preço unitário
    expect(row.getCell(6).value).toBe(50); // Prejuízo estimado
  });
});

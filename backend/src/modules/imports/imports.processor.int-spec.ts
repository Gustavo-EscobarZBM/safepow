import { Job } from 'bullmq';
import * as ExcelJS from 'exceljs';
import {
  adminQuery,
  appDataSource,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
} from '../../test-utils/test-db';
import { StorageService } from '../uploads/storage.service';
import { ProductImportJobData } from './imports.service';
import { ImportsProcessor } from './imports.processor';

// O @nestjs/bullmq instalado é distribuído como ESM, que o Jest (CommonJS) não carrega — e ele chega por
// imports.processor (Processor/WorkerHost) e por imports.service (InjectQueue). O teste não usa a fila,
// chama process() direto, então bastam decorators vazios e uma classe-base vazia no lugar.
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => () => undefined,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

async function spreadsheet(rows: [string, string, number][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Produtos');
  sheet.addRow(['Codigo', 'Nome', 'Preco']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('ImportsProcessor — histórico de preço registra a origem "import"', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('mudança de preço feita pela importação entra no histórico com source = import', async () => {
    const companyId = await seedCompany('Empresa Importação');
    const productId = await seedProduct({ companyId, barcode: '8001', unitPrice: 10 });
    const importJobId = (
      await adminQuery(
        `INSERT INTO import_jobs ("companyId", "fileName", "storageKey") VALUES ($1, 'p.xlsx', 'k') RETURNING id`,
        [companyId],
      )
    )[0].id;
    const buffer = await spreadsheet([['8001', 'Produto Importado', 15]]);
    const storage = { downloadBuffer: async () => buffer } as unknown as StorageService;
    const processor = new ImportsProcessor(await appDataSource(), storage);

    await processor.process({
      data: {
        importJobId,
        companyId,
        storageKey: 'k',
        mapping: { barcodeColumn: 'Codigo', nameColumn: 'Nome', unitPriceColumn: 'Preco' },
      },
    } as Job<ProductImportJobData>);

    const [job] = await adminQuery(`SELECT status, "successCount" FROM import_jobs WHERE id = $1`, [importJobId]);
    expect(job).toMatchObject({ status: 'completed', successCount: 1 });
    const history = await adminQuery(
      `SELECT "unitPrice", source FROM product_price_history WHERE "productId" = $1 ORDER BY seq`,
      [productId],
    );
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ unitPrice: '15.00', source: 'import' });
  });
});

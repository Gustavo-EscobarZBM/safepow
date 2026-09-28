import { ExportResourceHandler } from '../exports/export-handler';
import { ExportProductsDto } from './dto/export-products.dto';
import { Product } from './product.entity';
import { applyProductFilters } from './products-search';

/**
 * Exportação de produtos (SP3, spec 4): os 5 primeiros cabeçalhos são os canônicos do modelo de importação, então o
 * arquivo volta pela importação sem mapear. Mesmos filtros da busca da tela.
 */
export const productsExportHandler: ExportResourceHandler<Product, ExportProductsDto> = {
  fileBase: 'produtos',
  sheetName: 'Produtos',
  columns: [
    { header: 'Código de barras', type: 'text', width: 18, value: (p) => p.barcode },
    { header: 'Nome', type: 'text', width: 40, value: (p) => p.name },
    { header: 'SKU', type: 'text', width: 16, value: (p) => p.sku },
    { header: 'Preço de venda', type: 'money', width: 14, value: (p) => p.unitPrice },
    { header: 'Custo', type: 'money', width: 14, value: (p) => p.costPrice },
    { header: 'Situação', type: 'text', width: 12, value: (p) => (p.isActive ? 'Ativo' : 'Arquivado') },
  ],

  count(manager, filters) {
    const qb = manager.createQueryBuilder(Product, 'product');
    applyProductFilters(qb, filters);
    return qb.getCount();
  },

  page(manager, filters, afterId, limit) {
    const qb = manager.createQueryBuilder(Product, 'product');
    applyProductFilters(qb, filters);
    if (afterId) qb.andWhere('product.id > :afterId', { afterId });
    return qb.orderBy('product.id', 'ASC').take(limit).getMany();
  },
};

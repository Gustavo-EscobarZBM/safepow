import { ExportResourceHandler } from '../exports/export-handler';
import { ExportProductsDto } from './dto/export-products.dto';
import { Product } from './product.entity';
import { ProductView, withCatalogLabels } from './products-catalog';
import { applyProductFilters } from './products-search';

/**
 * Exportação de produtos (SP3, spec 4): os cabeçalhos são os canônicos do modelo de importação, então o arquivo volta
 * pela importação sem mapear — inclusive os de catálogo do SP4 4.1. Mesmos filtros da busca da tela.
 */
export const productsExportHandler: ExportResourceHandler<ProductView, ExportProductsDto> = {
  fileBase: 'produtos',
  sheetName: 'Produtos',
  columns: [
    { header: 'Código de barras', type: 'text', width: 18, value: (p) => p.barcode },
    { header: 'Nome', type: 'text', width: 40, value: (p) => p.name },
    { header: 'SKU', type: 'text', width: 16, value: (p) => p.sku },
    { header: 'Preço de venda', type: 'money', width: 14, value: (p) => p.unitPrice },
    { header: 'Custo', type: 'cost', width: 14, value: (p) => p.costPrice },
    { header: 'Categoria', type: 'text', width: 36, value: (p) => p.categoryPath },
    { header: 'Marca', type: 'text', width: 20, value: (p) => p.brandName },
    { header: 'Fornecedor', type: 'text', width: 28, value: (p) => p.supplierName },
    { header: 'Unidade', type: 'text', width: 9, value: (p) => p.unit },
    { header: 'Perecível', type: 'text', width: 10, value: (p) => (p.isPerishable ? 'Sim' : 'Não') },
    { header: 'Validade (dias)', type: 'text', width: 14, value: (p) => (p.shelfLifeDays == null ? null : String(p.shelfLifeDays)) },
    { header: 'Situação', type: 'text', width: 12, value: (p) => (p.isActive ? 'Ativo' : 'Arquivado') },
  ],

  count(manager, filters) {
    const qb = manager.createQueryBuilder(Product, 'product');
    applyProductFilters(qb, filters);
    return qb.getCount();
  },

  async page(manager, filters, afterId, limit) {
    const qb = manager.createQueryBuilder(Product, 'product');
    applyProductFilters(qb, filters);
    if (afterId) qb.andWhere('product.id > :afterId', { afterId });
    return withCatalogLabels(manager, await qb.orderBy('product.id', 'ASC').take(limit).getMany());
  },
};

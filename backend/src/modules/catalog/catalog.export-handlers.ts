import { ExportResourceHandler } from '../exports/export-handler';
import { Brand } from './brand.entity';
import { categoryPathMap, CategoryWithPath } from './categories.service';
import { Category } from './category.entity';
import { Supplier } from './supplier.entity';

const situacao = (r: { isActive: boolean }) => (r.isActive ? 'Ativo' : 'Arquivado');

/** Exportações das taxonomias do catálogo (SP4 4.1), no motor de streaming do SP3 (3.3). */
export const categoriesExportHandler: ExportResourceHandler<CategoryWithPath> = {
  fileBase: 'categorias',
  sheetName: 'Categorias',
  columns: [
    { header: 'Caminho', type: 'text', width: 50, value: (r) => r.path },
    { header: 'Situação', type: 'text', width: 12, value: situacao },
  ],
  count: (manager) => manager.count(Category),
  async page(manager, _filters, afterId, limit) {
    const qb = manager.createQueryBuilder(Category, 'c');
    if (afterId) qb.where('c.id > :afterId', { afterId });
    const rows = await qb.orderBy('c.id', 'ASC').take(limit).getMany();
    const paths = await categoryPathMap(manager);
    return rows.map((r) => ({ ...r, path: paths.get(r.id) ?? r.name }));
  },
};

export const brandsExportHandler: ExportResourceHandler<Brand> = {
  fileBase: 'marcas',
  sheetName: 'Marcas',
  columns: [
    { header: 'Nome', type: 'text', width: 40, value: (r) => r.name },
    { header: 'Situação', type: 'text', width: 12, value: situacao },
  ],
  count: (manager) => manager.count(Brand),
  page(manager, _filters, afterId, limit) {
    const qb = manager.createQueryBuilder(Brand, 'b');
    if (afterId) qb.where('b.id > :afterId', { afterId });
    return qb.orderBy('b.id', 'ASC').take(limit).getMany();
  },
};

export const suppliersExportHandler: ExportResourceHandler<Supplier> = {
  fileBase: 'fornecedores',
  sheetName: 'Fornecedores',
  columns: [
    { header: 'Nome', type: 'text', width: 40, value: (r) => r.name },
    { header: 'CNPJ/CPF', type: 'text', width: 20, value: (r) => r.taxId },
    { header: 'Contato', type: 'text', width: 24, value: (r) => r.contactName },
    { header: 'Telefone', type: 'text', width: 18, value: (r) => r.phone },
    { header: 'E-mail', type: 'text', width: 30, value: (r) => r.email },
    { header: 'Observações', type: 'text', width: 40, value: (r) => r.notes },
    { header: 'Situação', type: 'text', width: 12, value: situacao },
  ],
  count: (manager) => manager.count(Supplier),
  page(manager, _filters, afterId, limit) {
    const qb = manager.createQueryBuilder(Supplier, 's');
    if (afterId) qb.where('s.id > :afterId', { afterId });
    return qb.orderBy('s.id', 'ASC').take(limit).getMany();
  },
};

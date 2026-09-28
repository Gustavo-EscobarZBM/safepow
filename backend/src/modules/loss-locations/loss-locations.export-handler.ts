import { ExportResourceHandler } from '../exports/export-handler';
import { LossLocation } from './loss-location.entity';

/** Exportação de locais de perda (SP3, 3.3). Sem "Situação": locais ainda não são arquivados (SP5). */
export const lossLocationsExportHandler: ExportResourceHandler<LossLocation> = {
  fileBase: 'locais-de-perda',
  sheetName: 'Locais de perda',
  columns: [
    { header: 'Nome', type: 'text', width: 40, value: (r) => r.name },
    { header: 'Criado em', type: 'datetime', width: 18, value: (r) => r.createdAt },
  ],
  count: (manager) => manager.count(LossLocation),
  page(manager, _filters, afterId, limit) {
    const qb = manager.createQueryBuilder(LossLocation, 'r');
    if (afterId) qb.where('r.id > :afterId', { afterId });
    return qb.orderBy('r.id', 'ASC').take(limit).getMany();
  },
};

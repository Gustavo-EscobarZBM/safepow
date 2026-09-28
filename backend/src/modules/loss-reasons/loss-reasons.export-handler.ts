import { ExportResourceHandler } from '../exports/export-handler';
import { LossReason } from './loss-reason.entity';

/** Exportação de motivos de perda (SP3, 3.3). Sem "Situação": motivos ainda não são arquivados (SP5). */
export const lossReasonsExportHandler: ExportResourceHandler<LossReason> = {
  fileBase: 'motivos-de-perda',
  sheetName: 'Motivos de perda',
  columns: [
    { header: 'Nome', type: 'text', width: 40, value: (r) => r.name },
    { header: 'Criado em', type: 'datetime', width: 18, value: (r) => r.createdAt },
  ],
  count: (manager) => manager.count(LossReason),
  page(manager, _filters, afterId, limit) {
    const qb = manager.createQueryBuilder(LossReason, 'r');
    if (afterId) qb.where('r.id > :afterId', { afterId });
    return qb.orderBy('r.id', 'ASC').take(limit).getMany();
  },
};

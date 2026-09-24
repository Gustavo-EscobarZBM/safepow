import { BadRequestException, Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { getTenantManager } from '../../common/tenant/tenant-storage';
import { AuditLog } from './audit-log.entity';
import { QueryAuditDto } from './dto/query-audit.dto';

export const AUDIT_DEFAULT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_LIMIT = 50_000;

const CSV_HEADER = ['Data/hora', 'Pessoa', 'Papel', 'Origem', 'Ação', 'Entidade', 'Registro', 'Alterações', 'Justificativa', 'IP'];

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Nomes de produto/arquivo/pessoa são texto livre: começando com = + - @ (ou tab/CR) o Excel os leria como
  // fórmula. O apóstrofo faz o Excel tratar a célula como texto.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function describeChanges(changes: AuditLog['changes']): string {
  return changes.map((c) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' | ');
}

@Injectable()
export class AuditService {
  private filtered(query: QueryAuditDto): SelectQueryBuilder<AuditLog> {
    const qb = getTenantManager().createQueryBuilder(AuditLog, 'audit');
    if (query.entityType) qb.andWhere('audit.entityType = :entityType', { entityType: query.entityType });
    if (query.entityId) qb.andWhere('audit.entityId = :entityId', { entityId: query.entityId });
    if (query.actorUserId) qb.andWhere('audit.actorUserId = :actorUserId', { actorUserId: query.actorUserId });
    if (query.action) qb.andWhere('audit.action = :action', { action: query.action });
    if (query.from) qb.andWhere('audit.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('audit.createdAt <= :to', { to: new Date(query.to) });
    return qb.orderBy('audit.createdAt', 'DESC').addOrderBy('audit.seq', 'DESC');
  }

  async list(query: QueryAuditDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? AUDIT_DEFAULT_PAGE_SIZE;
    const [items, total] = await this.filtered(query)
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: items.map(({ seq: _seq, companyId: _companyId, ...rest }) => rest), total, page, pageSize };
  }

  /** CSV para Excel pt-BR: BOM UTF-8, ";" como separador, CRLF. Acima do limite, pede para filtrar. */
  async exportCsv(query: QueryAuditDto): Promise<string> {
    const qb = this.filtered(query);
    const total = await qb.getCount();
    if (total > AUDIT_EXPORT_LIMIT) {
      throw new BadRequestException(
        `A exportação tem ${total} linhas (máximo ${AUDIT_EXPORT_LIMIT}). Filtre por período ou entidade.`,
      );
    }
    const rows = await qb.getMany();
    const lines = [CSV_HEADER.join(';')];
    for (const row of rows) {
      lines.push(
        [
          row.createdAt.toISOString(),
          row.actorName,
          row.actorRole,
          row.source,
          row.action,
          row.entityType,
          row.entityLabel ?? row.entityId,
          describeChanges(row.changes),
          row.reason,
          row.ip,
        ]
          .map(csvCell)
          .join(';'),
      );
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { SaveImportMappingDto } from './dto/import-mapping.dto';
import { headerFingerprint } from './engine/mapping';
import { ImportResourceHandler } from './engine/types';
import { getImportHandler } from './handlers';
import { ImportMapping } from './import-mapping.entity';

export function mappingInvalid(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, errorCode: 'MAPPING_INVALID', message });
}

/** Campos conhecidos pelo handler, valores em texto. Não confere se os cabeçalhos existem (isso é da simulação). */
export function assertKnownFields(handler: ImportResourceHandler, mapping: Record<string, unknown>): void {
  const known = new Set(handler.fields.map((f) => f.key));
  for (const [field, header] of Object.entries(mapping)) {
    if (!known.has(field)) throw mappingInvalid(`Campo desconhecido: "${field}".`);
    if (typeof header !== 'string' || !header.trim()) throw mappingInvalid(`Informe a coluna do campo "${field}".`);
  }
}

/** Mapeamentos de colunas salvos por empresa (SP3, spec 1.3). */
@Injectable()
export class ImportMappingsService {
  list(resource: string): Promise<ImportMapping[]> {
    return getTenantManager().find(ImportMapping, { where: { resource }, order: { name: 'ASC' } });
  }

  async save(dto: SaveImportMappingDto): Promise<ImportMapping> {
    assertKnownFields(getImportHandler(dto.resource), dto.mapping);
    const { companyId, userId } = getTenantContext();
    const manager = getTenantManager();
    const existing = await manager.findOne(ImportMapping, { where: { resource: dto.resource, name: dto.name } });
    const mapping = existing ?? manager.create(ImportMapping, { companyId: companyId!, resource: dto.resource, name: dto.name });
    mapping.mapping = dto.mapping;
    mapping.headerFingerprint = headerFingerprint(dto.headers);
    mapping.createdByUserId = mapping.createdByUserId ?? (userId || null);
    return manager.save(mapping);
  }

  async remove(id: string): Promise<void> {
    const result = await getTenantManager().delete(ImportMapping, { id });
    if (!result.affected) throw new NotFoundException('Mapeamento não encontrado.');
  }

  findByFingerprint(resource: string, fingerprint: string): Promise<ImportMapping | null> {
    return getTenantManager().findOne(ImportMapping, {
      where: { resource, headerFingerprint: fingerprint },
      order: { lastUsedAt: { direction: 'DESC', nulls: 'LAST' }, createdAt: 'DESC' },
    });
  }

  async touch(id: string): Promise<void> {
    await getTenantManager().update(ImportMapping, { id }, { lastUsedAt: new Date() });
  }
}

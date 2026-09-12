import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { CreateLossLocationDto } from './dto/create-loss-location.dto';
import { UpdateLossLocationDto } from './dto/update-loss-location.dto';
import { LossLocation } from './loss-location.entity';

const FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class LossLocationsService {
  async create(dto: CreateLossLocationDto): Promise<LossLocation> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const existing = await manager.findOne(LossLocation, { where: { companyId: companyId!, name: dto.name } });
    if (existing) {
      throw new ConflictException('Já existe um local cadastrado com este nome.');
    }

    const location = manager.create(LossLocation, { companyId: companyId!, name: dto.name });
    return manager.save(location);
  }

  findAll(): Promise<LossLocation[]> {
    const manager = getTenantManager();
    return manager.find(LossLocation, { order: { name: 'ASC' } });
  }

  async update(id: string, dto: UpdateLossLocationDto): Promise<LossLocation> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const location = await manager.findOne(LossLocation, { where: { id } });
    if (!location) {
      throw new NotFoundException('Local não encontrado.');
    }

    if (dto.name !== location.name) {
      const existing = await manager.findOne(LossLocation, { where: { companyId: companyId!, name: dto.name } });
      if (existing) {
        throw new ConflictException('Já existe um local cadastrado com este nome.');
      }
      location.name = dto.name;
    }

    return manager.save(location);
  }

  /**
   * A FK de losses.locationId aponta pra cá com onDelete: RESTRICT — se o local
   * já foi usado em alguma perda, o Postgres recusa o delete (23503). Traduzimos
   * isso numa mensagem amigável em vez de deixar vazar um erro genérico.
   */
  async remove(id: string): Promise<void> {
    const manager = getTenantManager();
    try {
      const result = await manager.delete(LossLocation, id);
      if (result.affected === 0) {
        throw new NotFoundException('Local não encontrado.');
      }
    } catch (err) {
      if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        throw new ConflictException('Não é possível excluir: existem perdas registradas com este local.');
      }
      throw err;
    }
  }
}

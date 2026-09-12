import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { CreateLossReasonDto } from './dto/create-loss-reason.dto';
import { UpdateLossReasonDto } from './dto/update-loss-reason.dto';
import { LossReason } from './loss-reason.entity';

const FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class LossReasonsService {
  async create(dto: CreateLossReasonDto): Promise<LossReason> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const existing = await manager.findOne(LossReason, { where: { companyId: companyId!, name: dto.name } });
    if (existing) {
      throw new ConflictException('Já existe um motivo cadastrado com este nome.');
    }

    const reason = manager.create(LossReason, { companyId: companyId!, name: dto.name });
    return manager.save(reason);
  }

  findAll(): Promise<LossReason[]> {
    const manager = getTenantManager();
    return manager.find(LossReason, { order: { name: 'ASC' } });
  }

  async update(id: string, dto: UpdateLossReasonDto): Promise<LossReason> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const reason = await manager.findOne(LossReason, { where: { id } });
    if (!reason) {
      throw new NotFoundException('Motivo não encontrado.');
    }

    if (dto.name !== reason.name) {
      const existing = await manager.findOne(LossReason, { where: { companyId: companyId!, name: dto.name } });
      if (existing) {
        throw new ConflictException('Já existe um motivo cadastrado com este nome.');
      }
      reason.name = dto.name;
    }

    return manager.save(reason);
  }

  /**
   * A FK de losses.reasonId aponta pra cá com onDelete: RESTRICT — se o motivo
   * já foi usado em alguma perda, o Postgres recusa o delete (23503). Traduzimos
   * isso numa mensagem amigável em vez de deixar vazar um erro genérico.
   */
  async remove(id: string): Promise<void> {
    const manager = getTenantManager();
    try {
      const result = await manager.delete(LossReason, id);
      if (result.affected === 0) {
        throw new NotFoundException('Motivo não encontrado.');
      }
    } catch (err) {
      if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        throw new ConflictException('Não é possível excluir: existem perdas registradas com este motivo.');
      }
      throw err;
    }
  }
}

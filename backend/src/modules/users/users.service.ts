import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { Company } from '../companies/company.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserRole } from './user.entity';

const SALT_ROUNDS = 12;
const FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class UsersService {
  /**
   * Cria um novo usuário (funcionário ou gerente) dentro da mesma empresa do
   * gerente autenticado. A RLS (Seção 1.2) garante que companyId só pode ser
   * o do próprio tenant — não é necessário nenhum bypass aqui, diferente da
   * criação do primeiro gerente pelo Painel Master (ver CompaniesService).
   */
  async invite(dto: InviteUserDto): Promise<Omit<User, 'passwordHash'>> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    // A unicidade de e-mail é GLOBAL (Seção do login) — por isso a checagem
    // aqui não filtra por tenant; um e-mail só pode existir em uma empresa.
    const existing = await manager.findOne(User, { where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Já existe um usuário cadastrado com este e-mail.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = manager.create(User, {
      companyId: companyId!,
      name: dto.name,
      email: dto.email,
      passwordHash,
      role: dto.role,
    });
    const saved = await manager.save(user);
    const { passwordHash: _omit, ...rest } = saved;
    return rest;
  }

  async findAll(): Promise<Omit<User, 'passwordHash'>[]> {
    const manager = getTenantManager();
    const users = await manager.find(User, { order: { createdAt: 'DESC' } });
    return users.map(({ passwordHash: _omit, ...rest }) => rest);
  }

  /**
   * Autoatendimento — Configurações > Meu perfil (qualquer papel, inclusive
   * master_admin). Inclui companyName (não apenas o companyId técnico) para a
   * tela de Perfil do app mobile mostrar qual empresa o usuário está logado —
   * "companies" não tem RLS (não é dado de tenant, é o próprio tenant), então
   * a busca usa o mesmo manager sem precisar de bypass.
   */
  async getMe(): Promise<Omit<User, 'passwordHash'> & { companyName: string | null }> {
    const { userId } = getTenantContext();
    const manager = getTenantManager();
    const user = await manager.findOne(User, { where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    let companyName: string | null = null;
    if (user.companyId) {
      const company = await manager.findOne(Company, { where: { id: user.companyId } });
      companyName = company?.name ?? null;
    }

    const { passwordHash: _omit, ...rest } = user;
    return { ...rest, companyName };
  }

  /**
   * Autoatendimento: cada usuário edita a si mesmo. Funcionário só pode trocar
   * a própria senha — nome/e-mail continuam exclusivos do gerente (método
   * update() acima), evitando confusão de identidade/login no time.
   */
  async updateMe(dto: UpdateMeDto): Promise<Omit<User, 'passwordHash'>> {
    const { userId, role } = getTenantContext();
    const manager = getTenantManager();

    // passwordHash tem select:false no entity — precisa pedir explicitamente
    // para poder comparar a senha atual antes de aceitar uma nova.
    const user = await manager
      .createQueryBuilder(User, 'u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    if (role !== UserRole.EMPLOYEE) {
      if (dto.email && dto.email !== user.email) {
        const existing = await manager.findOne(User, { where: { email: dto.email } });
        if (existing) {
          throw new ConflictException('Já existe um usuário cadastrado com este e-mail.');
        }
        user.email = dto.email;
      }
      if (dto.name !== undefined) user.name = dto.name;
    }

    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new ConflictException('Informe a senha atual para definir uma nova.');
      }
      const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!matches) {
        throw new ConflictException('Senha atual incorreta.');
      }
      user.passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    }

    const saved = await manager.save(user);
    const { passwordHash: _omit, ...rest } = saved;
    return rest;
  }

  async setActive(id: string, isActive: boolean): Promise<Omit<User, 'passwordHash'>> {
    const manager = getTenantManager();
    const user = await manager.findOne(User, { where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    user.isActive = isActive;
    const saved = await manager.save(user);
    const { passwordHash: _omit, ...rest } = saved;
    return rest;
  }

  async update(id: string, dto: UpdateUserDto): Promise<Omit<User, 'passwordHash'>> {
    const manager = getTenantManager();
    const user = await manager.findOne(User, { where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    if (dto.email && dto.email !== user.email) {
      const existing = await manager.findOne(User, { where: { email: dto.email } });
      if (existing) {
        throw new ConflictException('Já existe um usuário cadastrado com este e-mail.');
      }
      user.email = dto.email;
    }
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const saved = await manager.save(user);
    const { passwordHash: _omit, ...rest } = saved;
    return rest;
  }

  /**
   * Exclusão definitiva. losses.reportedByUserId aponta pra cá com onDelete
   * RESTRICT (não dá pra apagar quem já registrou perdas sem perder o
   * histórico) — traduzimos a violação de FK (23503) numa mensagem amigável,
   * mesmo tratamento já usado em LossLocationsService/LossReasonsService.
   * Também bloqueia a auto-exclusão: um gerente não pode se excluir e correr
   * o risco de ficar sem nenhum gerente ativo na empresa.
   */
  async remove(id: string): Promise<void> {
    const { userId } = getTenantContext();
    if (id === userId) {
      throw new ConflictException('Você não pode excluir seu próprio usuário.');
    }

    const manager = getTenantManager();
    try {
      const result = await manager.delete(User, id);
      if (result.affected === 0) {
        throw new NotFoundException('Usuário não encontrado.');
      }
    } catch (err) {
      if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        throw new ConflictException(
          'Não é possível excluir: este usuário já registrou perdas. Desative-o em vez disso.',
        );
      }
      throw err;
    }
  }
}

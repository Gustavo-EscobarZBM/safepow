import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { getTenantContext, getTenantManager, tenantStorage } from '../../common/tenant/tenant-storage';
import { applyRequestAuditContext } from '../audit/audit-events';
import { LossLocation } from '../loss-locations/loss-location.entity';
import { LossReason } from '../loss-reasons/loss-reason.entity';
import { User, UserRole } from '../users/user.entity';
import { Company, CompanyStatus } from './company.entity';
import { computeEffectiveStatus } from './company-status.util';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

const SALT_ROUNDS = 12;

// Opções iniciais de Motivo/Local para toda empresa nova — o Gerente edita
// livremente depois em Cadastros, mas ninguém começa com a tela vazia sem
// conseguir registrar uma perda.
const DEFAULT_REASONS = ['Vencimento/Validade', 'Quebra/Avaria', 'Furto', 'Erro operacional', 'Outro'];
const DEFAULT_LOCATIONS = [
  'Loja/Gôndola',
  'Câmara fria',
  'Depósito/Estoque',
  'Recebimento de mercadoria',
  'Caixa/Frente de loja',
  'Outro',
];

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private readonly companiesRepository: Repository<Company>,
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Cria uma nova empresa cliente (tenant) e o usuário gerente inicial.
   * Ação exclusiva do Painel Master (ver CompaniesController).
   *
   * Nuance de RLS: a tabela "users" tem política WITH CHECK exigindo que
   * companyId bata com app.current_company_id da sessão. Como esta operação
   * roda no contexto do MASTER_ADMIN (que não tem tenant — Seção 6.1), não há
   * app.current_company_id definido pelo TenantContextMiddleware. Por isso
   * abrimos aqui uma transação dedicada e definimos a variável de sessão para
   * a empresa recém-criada só pelo tempo necessário para gravar o gerente —
   * é a mesma lógica de "bypass estreito e auditável" usada no login, só que
   * via SET LOCAL em vez de uma função SQL, porque aqui já sabemos exatamente
   * qual tenant deve ser autorizado.
   */
  async create(dto: CreateCompanyDto): Promise<Company> {
    const existingUser = await this.usersRepository.findOne({ where: { email: dto.managerEmail } });
    if (existingUser) {
      throw new ConflictException('Já existe um usuário cadastrado com este e-mail.');
    }

    const passwordHash = await bcrypt.hash(dto.managerPassword, SALT_ROUNDS);

    return this.dataSource.transaction(async (manager) => {
      // Transação própria: sem isto a auditoria da empresa criada sairia sem autor ("system").
      await applyRequestAuditContext(manager);
      const company = manager.create(Company, {
        name: dto.name,
        cnpj: dto.cnpj ?? null,
        planTier: dto.planTier ?? 'starter',
        status: CompanyStatus.ACTIVE,
        // Primeiro vencimento: sugestão padrão de 30 dias, ajustável pelo
        // Administrador Master no momento do cadastro (regra do Painel Master).
        currentPeriodEnd: dto.firstDueDate ? new Date(dto.firstDueDate) : this.addDays(new Date(), 30),
      });
      await manager.save(company);

      await manager.query(`SELECT set_config('app.current_company_id', $1, true)`, [company.id]);

      const managerUser = manager.create(User, {
        companyId: company.id,
        name: dto.managerName,
        email: dto.managerEmail,
        passwordHash,
        role: UserRole.MANAGER,
      });
      await manager.save(managerUser);

      await manager.save(
        DEFAULT_REASONS.map((name) => manager.create(LossReason, { companyId: company.id, name })),
      );
      await manager.save(
        DEFAULT_LOCATIONS.map((name) => manager.create(LossLocation, { companyId: company.id, name })),
      );

      return company;
    });
  }

  async getMySettings(): Promise<{ lossVerificationEnabled: boolean; lossVerifierId: string | null }> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    const company = await manager.findOne(Company, { where: { id: companyId! } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return { lossVerificationEnabled: company.lossVerificationEnabled, lossVerifierId: company.lossVerifierId };
  }

  /**
   * Autoatendimento do gerente — diferente de update() (Painel Master, dados
   * cadastrais/billing de qualquer empresa). Restrito aos dois campos da
   * conferência de descarte.
   */
  async updateMySettings(
    dto: UpdateCompanySettingsDto,
  ): Promise<{ lossVerificationEnabled: boolean; lossVerifierId: string | null }> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    const company = await manager.findOne(Company, { where: { id: companyId! } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    if (dto.lossVerificationEnabled !== undefined) {
      company.lossVerificationEnabled = dto.lossVerificationEnabled;
    }
    if (dto.lossVerifierId !== undefined) {
      if (dto.lossVerifierId !== null) {
        const verifier = await manager.findOne(User, { where: { id: dto.lossVerifierId } });
        if (!verifier) throw new NotFoundException('Usuário conferente não encontrado.');
      }
      company.lossVerifierId = dto.lossVerifierId;
    }

    await manager.save(company);
    return { lossVerificationEnabled: company.lossVerificationEnabled, lossVerifierId: company.lossVerifierId };
  }

  /**
   * Lista as empresas já com o status recalculado a partir do vencimento
   * (auto-cura: se o valor gravado estiver desatualizado, persiste o novo
   * valor antes de responder — ver company-status.util.ts). Sequencial de
   * propósito, mesma cautela usada no resto do projeto para não paralelizar
   * escritas.
   */
  async findAll(): Promise<Company[]> {
    const companies = await this.companiesRepository.find({ order: { createdAt: 'DESC' } });
    const result: Company[] = [];
    for (const company of companies) {
      result.push(await this.syncStatus(company));
    }
    return result;
  }

  async findOneOrFail(id: string): Promise<Company> {
    const company = await this.companiesRepository.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return company;
  }

  /**
   * Edita os dados cadastrais da empresa (nome, CNPJ, plano, vencimento).
   * Não mexe em status — isso continua exclusivo de updateStatus/renew/unlock,
   * que têm efeitos colaterais no bloqueio de acesso (Seção 6.2).
   */
  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    const company = await this.findOneOrFail(id);
    if (dto.name !== undefined) company.name = dto.name;
    if (dto.cnpj !== undefined) company.cnpj = dto.cnpj || null;
    if (dto.planTier !== undefined) company.planTier = dto.planTier;
    if (dto.currentPeriodEnd !== undefined) company.currentPeriodEnd = new Date(dto.currentPeriodEnd);
    return this.saveMasterAction(company);
  }

  /**
   * Bloqueia ou reativa uma empresa manualmente pelo Painel Master. O efeito é
   * imediato: a próxima requisição do app/painel dessa empresa passa pelo
   * SubscriptionGuard e recebe 402 SUBSCRIPTION_INACTIVE (Seção 6.2 do documento).
   */
  async updateStatus(id: string, status: CompanyStatus): Promise<Company> {
    const company = await this.findOneOrFail(id);
    company.status = status;
    return this.saveMasterAction(company);
  }

  /**
   * Ação "Renovar": gera um novo ciclo de 30 dias a partir de hoje (não da
   * data antiga de vencimento) e volta o status para Ativo.
   */
  async renew(id: string): Promise<Company> {
    const company = await this.findOneOrFail(id);
    company.currentPeriodEnd = this.addDays(new Date(), 30);
    company.status = CompanyStatus.ACTIVE;
    return this.saveMasterAction(company);
  }

  /**
   * Ação "Desbloquear": reativa o acesso manualmente sem renovar o ciclo.
   * Marca o momento do desbloqueio para que o cálculo automático de status
   * não bloqueie de novo pelo mesmo vencimento já perdoado.
   */
  async unlock(id: string): Promise<Company> {
    const company = await this.findOneOrFail(id);
    company.lastManualUnlockAt = new Date();
    company.status = computeEffectiveStatus(company);
    return this.saveMasterAction(company);
  }

  /**
   * Exclui a empresa e, em cascata, seus usuários/produtos/perdas/import jobs.
   * Essas tabelas têm RLS (companyId = app.current_company_id) — sem definir
   * o contexto de tenant, o DELETE em cascata disparado pela FK não enxergaria
   * as linhas dependentes. Reaproveita o mesmo bypass estreito e auditável já
   * usado em create(): define a variável de sessão só pelo tempo da transação.
   */
  async remove(id: string): Promise<void> {
    await this.findOneOrFail(id);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_company_id', $1, true)`, [id]);
      await manager.delete(Company, id);
    });
  }

  /**
   * Ação do Master: grava na transação da própria requisição (que já carrega ator, origem, requestId e IP para
   * a auditoria). O repositório injetado usaria outra conexão do pool e a mudança sairia sem autor. Fora de
   * requisição (testes unitários), cai no repositório. `companies` não tem RLS, então o Master (sem tenant)
   * grava normalmente. A auto-cura de status em syncStatus continua no repositório: é mudança do sistema.
   */
  private saveMasterAction(company: Company): Promise<Company> {
    const context = tenantStorage.getStore();
    return context ? context.manager.save(Company, company) : this.companiesRepository.save(company);
  }

  private async syncStatus(company: Company): Promise<Company> {
    const effective = computeEffectiveStatus(company);
    if (effective === company.status) {
      return company;
    }
    company.status = effective;
    return this.companiesRepository.save(company);
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}

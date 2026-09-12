import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { Company, CompanyStatus } from '../../modules/companies/company.entity';
import { computeEffectiveStatus } from '../../modules/companies/company-status.util';
import { UserRole } from '../../modules/users/user.entity';

/**
 * Implementa o bloqueio remoto do Painel Master (Seção 6.2 do documento):
 * toda requisição autenticada de um usuário vinculado a uma empresa (manager
 * ou employee) passa por aqui antes de chegar ao handler. Se a assinatura não
 * estiver ativa (ou em trial), a API responde 402 com um código de erro
 * padronizado que o app e o painel web sabem interpretar como "acesso suspenso".
 *
 * MASTER_ADMIN nunca é bloqueado por este guard (ele não pertence a uma empresa).
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authUser = req.authUser;

    if (!authUser || authUser.role === UserRole.MASTER_ADMIN) {
      return true;
    }

    if (!authUser.companyId) {
      return true;
    }

    const company = await this.companiesRepository.findOne({
      where: { id: authUser.companyId },
    });

    // Auto-cura: recalcula o status a partir do vencimento (Painel Master) e
    // persiste se estiver desatualizado, antes de decidir permitir ou não.
    if (company) {
      const effective = computeEffectiveStatus(company);
      if (effective !== company.status) {
        company.status = effective;
        await this.companiesRepository.save(company);
      }
    }

    const allowedStatuses = [CompanyStatus.TRIAL, CompanyStatus.ACTIVE, CompanyStatus.PAST_DUE];
    if (!company || !allowedStatuses.includes(company.status)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          errorCode: 'SUBSCRIPTION_INACTIVE',
          message:
            'O acesso desta empresa está suspenso. Entre em contato com o financeiro para regularizar a assinatura.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}

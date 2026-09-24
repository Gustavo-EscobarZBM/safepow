import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { Company, CompanyStatus } from '../companies/company.entity';
import { computeEffectiveStatus } from '../companies/company-status.util';
import { UserRole } from '../users/user.entity';
import { auditSourceFromUserAgent, recordAuditEvent } from '../audit/audit-events';

interface AuthLookupRow {
  id: string;
  companyId: string | null;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  name: string;
}

export interface LoginClientInfo {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    @InjectRepository(Company) private readonly companiesRepository: Repository<Company>,
  ) {}

  async login(email: string, password: string, client: LoginClientInfo = {}) {
    // Chama a função SQL SECURITY DEFINER (ver migration InitialSchema) em vez de
    // usar um repositório comum: a RLS bloquearia esta busca por e-mail, já que
    // o tenant do usuário ainda não é conhecido neste momento do fluxo.
    const rows: AuthLookupRow[] = await this.dataSource.query(
      `SELECT * FROM auth_lookup_user_by_email($1)`,
      [email],
    );
    const user = rows[0];

    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    const passwordMatches = user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!passwordMatches) {
      await this.auditLogin(user, 'login_failed', client);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    let companyStatus: CompanyStatus | undefined;
    let companyDueDate: Date | null | undefined;
    let lossVerificationEnabled = false;
    let isLossVerifier = false;

    // MASTER_ADMIN não pertence a uma empresa — só empresas clientes (gerente/
    // funcionário) passam pela checagem de mensalidade no login (item 4 do
    // pedido do Painel Master: "Vencida" avisa e permite, "Bloqueada" barra).
    if (user.role !== UserRole.MASTER_ADMIN && user.companyId) {
      const company = await this.companiesRepository.findOne({ where: { id: user.companyId } });
      if (!company) {
        throw new UnauthorizedException('E-mail ou senha inválidos.');
      }

      const effective = computeEffectiveStatus(company);
      if (effective !== company.status) {
        company.status = effective;
        await this.companiesRepository.save(company);
      }

      if (effective === CompanyStatus.BLOCKED || effective === CompanyStatus.CANCELED) {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            errorCode: 'COMPANY_BLOCKED',
            message:
              'O acesso desta empresa está bloqueado por pendência de mensalidade. Entre em contato com o suporte para regularizar a situação.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      companyStatus = effective;
      companyDueDate = company.currentPeriodEnd;
      lossVerificationEnabled = company.lossVerificationEnabled;
      isLossVerifier = company.lossVerifierId === user.id;
    }

    await this.auditLogin(user, 'login', client);

    const payload = { sub: user.id, role: user.role, companyId: user.companyId };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      },
      companyStatus,
      companyDueDate,
      lossVerificationEnabled,
      isLossVerifier,
    };
  }

  /**
   * Login roda sem contexto de tenant (e a transação do middleware é desfeita em 401) — por isso grava numa
   * transação própria, com o contexto do usuário. Falha ao auditar NÃO derruba o login: registra no log do
   * servidor e segue.
   */
  private async auditLogin(user: AuthLookupRow, action: 'login' | 'login_failed', client: LoginClientInfo) {
    if (!user.companyId) return;
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `SELECT set_config('app.current_company_id', $1, true), set_config('app.current_user_id', $2, true),
                  set_config('app.audit_source', $3, true), set_config('app.request_id', $4, true),
                  set_config('app.client_ip', $5, true)`,
          [user.companyId, user.id, auditSourceFromUserAgent(client.userAgent), client.requestId ?? '', client.ip ?? ''],
        );
        await recordAuditEvent(manager, {
          companyId: user.companyId!,
          entityType: 'session',
          entityId: user.id,
          entityLabel: user.name,
          action,
        });
      });
    } catch (error) {
      this.logger.warn(`Não foi possível auditar o ${action} de ${user.id}: ${(error as Error).message}`);
    }
  }
}

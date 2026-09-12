import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { Company, CompanyStatus } from '../companies/company.entity';
import { computeEffectiveStatus } from '../companies/company-status.util';
import { UserRole } from '../users/user.entity';

interface AuthLookupRow {
  id: string;
  companyId: string | null;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    @InjectRepository(Company) private readonly companiesRepository: Repository<Company>,
  ) {}

  async login(email: string, password: string) {
    // Chama a função SQL SECURITY DEFINER (ver migration InitialSchema) em vez de
    // usar um repositório comum: a RLS bloquearia esta busca por e-mail, já que
    // o tenant do usuário ainda não é conhecido neste momento do fluxo.
    const rows: AuthLookupRow[] = await this.dataSource.query(
      `SELECT * FROM auth_lookup_user_by_email($1)`,
      [email],
    );
    const user = rows[0];

    if (!user || !user.isActive) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    let companyStatus: CompanyStatus | undefined;
    let companyDueDate: Date | null | undefined;

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
    }

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
    };
  }
}

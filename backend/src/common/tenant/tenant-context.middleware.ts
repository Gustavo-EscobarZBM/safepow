import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { tenantStorage } from './tenant-storage';
import { UserRole } from '../../modules/users/user.entity';

export interface JwtPayload {
  sub: string; // userId
  role: UserRole;
  companyId: string | null;
}

// Express aumentado para carregar o usuário autenticado nas rotas — usado pelos
// guards de papel (RolesGuard) e pelo decorator @CurrentUser().
declare module 'express' {
  interface Request {
    authUser?: JwtPayload;
  }
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    let payload: JwtPayload | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        payload = await this.jwtService.verifyAsync<JwtPayload>(authHeader.slice(7));
        req.authUser = payload;
      } catch {
        // Token ausente/inválido: segue sem usuário autenticado. Rotas protegidas
        // são barradas pelo JwtAuthGuard, que roda depois deste middleware.
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (payload?.companyId) {
        // set_config(..., true) com is_local=true: a variável só vale dentro
        // desta transação — a próxima requisição, em outra transação, começa limpa.
        await queryRunner.query(`SELECT set_config('app.current_company_id', $1, true)`, [
          payload.companyId,
        ]);
      }

      const context = {
        userId: payload?.sub ?? '',
        role: payload?.role ?? UserRole.EMPLOYEE,
        companyId: payload?.companyId ?? null,
        manager: queryRunner.manager,
      };

      res.on('finish', () => {
        const commitOrRollback =
          res.statusCode >= 200 && res.statusCode < 400
            ? queryRunner.commitTransaction()
            : queryRunner.rollbackTransaction();

        commitOrRollback
          .catch(() => undefined)
          .finally(() => queryRunner.release());
      });

      tenantStorage.run(context, () => next());
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
      await queryRunner.release();
      next(err);
    }
  }
}

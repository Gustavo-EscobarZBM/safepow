import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { DataSource, QueryRunner } from 'typeorm';
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
  private readonly logger = new Logger(TenantContextMiddleware.name);

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
      if (payload?.sub) {
        // Quem está agindo — lido pelo trigger do histórico de preço (changedByUserId). Um id que não
        // existe mais (token de usuário excluído) vira NULL lá dentro (migration 1700000013000).
        await queryRunner.query(`SELECT set_config('app.current_user_id', $1, true)`, [payload.sub]);
      }

      const context = {
        userId: payload?.sub ?? '',
        role: payload?.role ?? UserRole.EMPLOYEE,
        companyId: payload?.companyId ?? null,
        manager: queryRunner.manager,
      };

      this.finishTransactionBeforeResponse(res, queryRunner);

      tenantStorage.run(context, () => next());
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
      await queryRunner.release();
      next(err);
    }
  }

  /**
   * A resposta só é entregue DEPOIS de a transação terminar. Antes, o commit ficava em
   * `res.on('finish')` — que dispara depois de a resposta já ter saído — e o cliente
   * (ex.: o app, que sincroniza logo em seguida) podia ler antes do commit. Também
   * engolia falha de commit: o cliente recebia sucesso de algo que não foi gravado.
   *
   * Todo caminho de resposta do Express/Nest (json, send, download, stream com pipe)
   * termina em `res.end`, por isso é ali que a transação é finalizada.
   */
  private finishTransactionBeforeResponse(res: Response, queryRunner: QueryRunner): void {
    const originalEnd = res.end.bind(res) as unknown as (...args: unknown[]) => Response;
    let endRequested = false;

    res.end = ((...args: unknown[]) => {
      // Só o primeiro `end` vale — como no Node nativo, onde os seguintes são ignorados.
      if (endRequested) return res;
      endRequested = true;

      // Enquanto a transação finaliza a resposta ainda não saiu, mas quem consulta `headersSent`
      // (o filtro de exceções do Nest, o finalhandler do Express) precisa enxergar "já respondida":
      // senão tentaria responder de novo e corromperia a resposta pendente (status/Content-Length
      // tardios) ou estouraria ERR_STREAM_WRITE_AFTER_END. O valor real é guardado para o ramo de
      // falha de commit abaixo.
      const headersAlreadySent = res.headersSent;
      Object.defineProperty(res, 'headersSent', { configurable: true, get: () => true });

      this.finishTransaction(queryRunner, res.statusCode >= 200 && res.statusCode < 400).then(
        () => {
          originalEnd(...args);
        },
        () => {
          // O commit falhou: o cliente não pode receber um sucesso que não foi gravado.
          if (headersAlreadySent) {
            originalEnd();
            return;
          }
          res.statusCode = 500;
          res.removeHeader('Content-Length');
          res.removeHeader('ETag');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          originalEnd(JSON.stringify({ statusCode: 500, message: 'Erro interno ao concluir a operação.' }));
        },
      ).catch((error: unknown) => {
        this.logger.error(
          `Falha ao entregar a resposta após finalizar a transação: ${error instanceof Error ? error.message : String(error)}`,
        );
        res.destroy();
      });
      return res;
    }) as Response['end'];
  }

  private async finishTransaction(queryRunner: QueryRunner, commit: boolean): Promise<void> {
    try {
      if (commit) {
        await queryRunner.commitTransaction();
      } else {
        await queryRunner.rollbackTransaction();
      }
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction().catch(() => undefined);
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

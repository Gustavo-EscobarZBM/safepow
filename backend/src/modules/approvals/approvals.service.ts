import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { recordAuditEvent } from '../audit/audit-events';
import { Loss } from '../losses/loss.entity';
import { LossesService, lossSnapshot } from '../losses/losses.service';
import { Product } from '../products/product.entity';
import { ProductsService, productSnapshot, retroFixSnapshot } from '../products/products.service';
import { computeRetroFixImpact } from '../products/products-retro-fix';
import { ChangeRequest, ChangeRequestStatus } from './change-request.entity';

export interface ChangeRequestView {
  id: string;
  policy: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  operation: string;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  justification: string;
  status: ChangeRequestStatus;
  requestedByUserId: string | null;
  requestedByName: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
}

const LIST_LIMIT = 200;
const VIEW_SELECT = `
  SELECT cr.id, cr.policy, cr."entityType", cr."entityId", cr."entityLabel", cr.operation, cr.payload, cr.snapshot,
         cr.justification, cr.status, cr."requestedByUserId", req.name AS "requestedByName",
         cr."decidedByUserId", dec.name AS "decidedByName", cr."decidedAt", cr."decisionNote", cr."expiresAt", cr."createdAt"
    FROM change_requests cr
    LEFT JOIN users req ON req.id = cr."requestedByUserId"
    LEFT JOIN users dec ON dec.id = cr."decidedByUserId"`;

/** Compara só as chaves gravadas no pedido (o jsonb não preserva a ordem das chaves). */
function sameSnapshot(saved: Record<string, unknown>, current: Record<string, unknown>): boolean {
  return Object.keys(saved).every((key) => JSON.stringify(saved[key]) === JSON.stringify(current[key]));
}

/**
 * Fila de pedidos de aprovação (SP2, spec 3.4). Tudo roda na transação da requisição: se a reaplicação
 * lançar, o rollback do middleware desfaz tudo e o pedido continua pendente.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly lossesService: LossesService,
  ) {}

  /** Expiração preguiçosa (sem job agendado). */
  private async expireOverdue(): Promise<void> {
    await getTenantManager().query(
      `UPDATE change_requests
          SET status = 'expired', "decidedAt" = now(), "decisionNote" = 'Prazo de 7 dias vencido.'
        WHERE status = 'pending' AND "expiresAt" < now()`,
    );
  }

  async list(status: 'pending' | 'decided' = 'pending'): Promise<ChangeRequestView[]> {
    await this.expireOverdue();
    return getTenantManager().query(
      `${VIEW_SELECT} WHERE ${status === 'pending' ? `cr.status = 'pending'` : `cr.status <> 'pending'`}
       ORDER BY COALESCE(cr."decidedAt", cr."createdAt") DESC LIMIT ${LIST_LIMIT}`,
    );
  }

  async pendingCount(): Promise<{ count: number }> {
    await this.expireOverdue();
    const rows: { n: number }[] = await getTenantManager().query(
      `SELECT count(*)::int AS n FROM change_requests WHERE status = 'pending'`,
    );
    return { count: rows[0]?.n ?? 0 };
  }

  async approve(id: string, note?: string): Promise<ChangeRequestView> {
    const { userId } = getTenantContext();
    const manager = getTenantManager();
    const request = await this.loadPendingForDecision(id);

    const current = await this.currentSnapshot(request);
    if (!current || !sameSnapshot(request.snapshot, current)) {
      // Devolve 200 com o pedido "expired": lançar um erro desfaria a marcação no rollback.
      await this.decide(request.id, 'expired', current ? 'O registro mudou desde o pedido.' : 'O registro não existe mais.', null);
      return this.findView(request.id);
    }

    // A linha do trigger leva a justificativa original; o histórico de preço registra a origem "approval".
    await manager.query(`SELECT set_config('app.audit_reason', $1, true), set_config('app.change_source', 'approval', true)`, [
      request.justification,
    ]);
    await this.apply(request);

    await manager.query(`SELECT set_config('app.audit_reason', $1, true)`, [note ?? '']);
    await this.decide(request.id, 'approved', note ?? null, userId);
    await recordAuditEvent(manager, {
      companyId: request.companyId,
      entityType: 'change_request',
      entityId: request.id,
      entityLabel: request.entityLabel,
      action: 'approve',
      summary: { policy: request.policy, entityType: request.entityType, entityId: request.entityId, operation: request.operation },
    });
    return this.findView(request.id);
  }

  async reject(id: string, note?: string): Promise<ChangeRequestView> {
    const { userId } = getTenantContext();
    const manager = getTenantManager();
    const request = await this.loadPendingForDecision(id);

    await manager.query(`SELECT set_config('app.audit_reason', $1, true)`, [note ?? '']);
    await this.decide(request.id, 'rejected', note ?? null, userId);
    await recordAuditEvent(manager, {
      companyId: request.companyId,
      entityType: 'change_request',
      entityId: request.id,
      entityLabel: request.entityLabel,
      action: 'reject',
      summary: { policy: request.policy, entityType: request.entityType, entityId: request.entityId, operation: request.operation },
    });
    return this.findView(request.id);
  }

  async cancel(id: string): Promise<ChangeRequestView> {
    const { userId } = getTenantContext();
    const request = await this.loadPending(id);
    if (request.requestedByUserId !== userId) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'NOT_REQUESTER',
        message: 'Só quem fez o pedido pode cancelá-lo.',
      });
    }
    await this.decide(request.id, 'cancelled', 'Cancelado por quem pediu.', userId);
    return this.findView(request.id);
  }

  private async loadPending(id: string): Promise<ChangeRequest> {
    await this.expireOverdue();
    // Trava a linha até o fim da transação: duas decisões simultâneas (aprovar × recusar, ou aprovar duas
    // vezes) viram uma fila — a segunda relê o pedido já decidido e recebe 409.
    const request = await getTenantManager().findOne(ChangeRequest, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!request) throw new NotFoundException('Pedido não encontrado.');
    if (request.status !== 'pending') {
      throw new ConflictException({
        statusCode: 409,
        errorCode: 'REQUEST_NOT_PENDING',
        message: 'Este pedido já foi decidido ou expirou.',
        status: request.status,
      });
    }
    return request;
  }

  private async loadPendingForDecision(id: string): Promise<ChangeRequest> {
    const request = await this.loadPending(id);
    if (request.requestedByUserId === getTenantContext().userId) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'SELF_APPROVAL',
        message: 'Quem pediu a mudança não pode aprová-la nem recusá-la.',
      });
    }
    return request;
  }

  private async decide(id: string, status: ChangeRequestStatus, note: string | null, deciderId: string | null) {
    await getTenantManager().query(
      `UPDATE change_requests SET status = $2, "decisionNote" = $3, "decidedByUserId" = $4, "decidedAt" = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, status, note, deciderId || null],
    );
  }

  private async findView(id: string): Promise<ChangeRequestView> {
    const rows: ChangeRequestView[] = await getTenantManager().query(`${VIEW_SELECT} WHERE cr.id = $1`, [id]);
    return rows[0];
  }

  private async currentSnapshot(request: ChangeRequest): Promise<Record<string, unknown> | null> {
    const manager = getTenantManager();
    if (request.operation === 'retro_fix') {
      // O que importa é a janela: perda nova ou corrigida por outro caminho invalida o pedido.
      const payload = request.payload as { from: string; to: string; unitPrice: number; costPrice: number };
      const product = await manager.findOne(Product, { where: { id: request.entityId! }, lock: { mode: 'pessimistic_write' } });
      if (!product) return null;
      const impact = await computeRetroFixImpact(
        manager,
        product.id,
        { from: new Date(payload.from), to: new Date(payload.to) },
        payload.unitPrice,
        payload.costPrice,
      );
      return retroFixSnapshot(impact);
    }
    if (request.entityType === 'product') {
      // Travada também: uma edição concorrente do registro espera a aprovação terminar (ou vice-versa).
      const product = await manager.findOne(Product, { where: { id: request.entityId! }, lock: { mode: 'pessimistic_write' } });
      return product ? productSnapshot(product) : null;
    }
    if (request.entityType === 'loss') {
      const loss = await manager.findOne(Loss, { where: { id: request.entityId! }, lock: { mode: 'pessimistic_write' } });
      return loss ? lossSnapshot(loss) : null;
    }
    return null;
  }

  /** Reaplica pelo MESMO método de serviço (mesmas validações), com a política dispensada. */
  private async apply(request: ChangeRequest): Promise<void> {
    const skip = { skipPolicy: true };
    switch (`${request.entityType}.${request.operation}`) {
      case 'product.update':
        await this.productsService.update(request.entityId!, request.payload as never, skip);
        return;
      case 'product.retro_fix':
        await this.productsService.retroFix(
          request.entityId!,
          { ...(request.payload as never as Record<string, unknown>), justification: request.justification } as never,
          skip,
        );
        return;
      case 'product.archive':
        await this.productsService.remove(request.entityId!, undefined, skip);
        return;
      case 'loss.update':
        await this.lossesService.update(request.entityId!, request.payload as never, skip);
        return;
      case 'loss.delete':
        await this.lossesService.remove(request.entityId!, undefined, skip);
        return;
      default:
        throw new BadRequestException('Tipo de pedido desconhecido.');
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { Loss } from '../losses/loss.entity';
import { GateOptions, PendingApproval, applyApprovalGate, loadCompanyPolicies } from '../approvals/approval-gate';
import { priceChangeExceeds } from '../approvals/approval-policies';
import { User } from '../users/user.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { SearchProductsDto } from './dto/search-products.dto';
import { SyncProductsQueryDto } from './dto/sync-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { RetroFixDto, RetroFixQueryDto } from './dto/retro-fix.dto';
import { RetroFixImpact, computeRetroFixImpact, resolveRetroFixWindow } from './products-retro-fix';
import { recordAuditEvent } from '../audit/audit-events';
import { barcodeConflict, isBarcodeUniqueViolation } from './product-errors';
import { Product } from './product.entity';
import { DEFAULT_PAGE_SIZE, escapeLikePattern, ProductSearchResult } from './products-search';
import { formatSyncCursor, parseSyncCursor, SYNC_TIMESTAMP_SQL } from './products-sync';
import { PriceChangeSource, ProductPriceHistory } from './product-price-history.entity';

export interface PriceHistoryEntry {
  id: string;
  unitPrice: number;
  costPrice: number;
  validFrom: Date;
  source: PriceChangeSource;
  changedByUserId: string | null;
  changedByName: string | null;
}

const PRICE_HISTORY_LIMIT = 100;

export interface SyncPage {
  items: Product[];
  /** now() do banco no início da requisição — o app guarda isto como "sincronizado até" (não o relógio dele). */
  syncCursor: string;
  /** Cursor para a próxima página; só quando esta veio cheia (há, ou pode haver, mais). */
  nextAfter: string | null;
}

/**
 * Nenhum método aqui filtra manualmente por companyId — a Row Level Security
 * do PostgreSQL (migration InitialSchema) já garante isso na conexão aberta
 * pelo TenantContextMiddleware. Definir companyId explicitamente no INSERT
 * (abaixo) ainda é necessário porque a política WITH CHECK exige que o valor
 * gravado bata com app.current_company_id — é a segunda camada de defesa
 * descrita na Seção 1.2 do documento, não uma substituição da primeira.
 */
/**
 * O que precisa continuar igual entre o pedido de correção retroativa e a aprovação: as perdas da janela e o
 * valor delas (uma perda nova ou corrigida por outro caminho invalida o pedido).
 */
export function retroFixSnapshot(impact: RetroFixImpact): Record<string, unknown> {
  return {
    affectedLosses: impact.affectedLosses,
    currentTotal: impact.currentTotal.toFixed(2),
    currentCostTotal: impact.currentCostTotal.toFixed(2),
  };
}

/** Campos comparados para detectar que o produto mudou entre o pedido e a aprovação (SP2, 3.4). */
export function productSnapshot(product: Product): Record<string, unknown> {
  return {
    barcode: product.barcode,
    name: product.name,
    sku: product.sku ?? null,
    unitPrice: String(product.unitPrice),
    costPrice: String(product.costPrice),
    isActive: product.isActive,
  };
}

@Injectable()
export class ProductsService {
  async create(dto: CreateProductDto): Promise<Product> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const existing = await manager.findOne(Product, { where: { companyId: companyId!, barcode: dto.barcode } });
    if (existing) {
      throw barcodeConflict(existing);
    }

    const product = manager.create(Product, {
      companyId: companyId!,
      barcode: dto.barcode,
      sku: dto.sku ?? null,
      name: dto.name,
      unitPrice: dto.unitPrice ?? 0,
      costPrice: dto.costPrice ?? 0,
    });
    try {
      return await manager.save(product);
    } catch (error) {
      // Dois cadastros simultâneos do mesmo código: o segundo passa pela checagem acima e esbarra no
      // índice único — responde o mesmo 409 em vez de 500.
      if (isBarcodeUniqueViolation(error)) throw barcodeConflict(null);
      throw error;
    }
  }

  /**
   * Catálogo para o sync do app (Seção 4.3 do documento; SP1, 6.1). Sem os parâmetros novos, a consulta é
   * exatamente a de antes (app instalado). Com eles: tombstones opcionais (R1) e páginas por cursor com
   * precisão de microssegundos e desempate por id (R5) — produtos com o mesmo updatedAt nunca repetem nem
   * somem entre páginas.
   */
  async findForSync(query: SyncProductsQueryDto): Promise<SyncPage> {
    const manager = getTenantManager();
    const [{ cursor: syncCursor }] = await manager.query(
      `SELECT ${SYNC_TIMESTAMP_SQL('now()')} AS cursor`,
    );

    const legacy = query.includeArchived === undefined && query.limit === undefined && query.after === undefined;
    if (legacy) {
      const items = query.since
        ? await manager
            .createQueryBuilder(Product, 'product')
            .where('product.isActive = true')
            .andWhere('product.updatedAt > :since', { since: new Date(query.since) })
            .orderBy('product.updatedAt', 'ASC')
            .getMany()
        : await manager.find(Product, { where: { isActive: true }, order: { name: 'ASC' } });
      return { items, syncCursor, nextAfter: null };
    }

    const qb = manager
      .createQueryBuilder(Product, 'product')
      .addSelect(SYNC_TIMESTAMP_SQL('product.updatedAt'), 'sync_updated_at');
    if (!query.includeArchived) qb.andWhere('product.isActive = true');
    if (query.since) qb.andWhere('product.updatedAt > :since', { since: new Date(query.since) });
    if (query.after) {
      const { afterAt, afterId } = parseSyncCursor(query.after);
      qb.andWhere('(product.updatedAt, product.id) > (CAST(:afterAt AS timestamptz), CAST(:afterId AS uuid))', {
        afterAt,
        afterId,
      });
    }
    qb.orderBy('product.updatedAt', 'ASC').addOrderBy('product.id', 'ASC');
    if (query.limit) qb.limit(query.limit);

    const { entities, raw } = await qb.getRawAndEntities<{ sync_updated_at: string }>();
    const full = query.limit !== undefined && entities.length === query.limit;
    const last = entities.length - 1;
    const nextAfter = full ? formatSyncCursor(raw[last].sync_updated_at, entities[last].id) : null;
    return { items: entities, syncCursor, nextAfter };
  }


  /**
   * Busca paginada no servidor para o painel (F10): nome por conteúdo, código de barras e SKU por prefixo,
   * com os curingas do texto escapados. O `GET /products` (sync do app) continua separado e inalterado.
   */
  async search(dto: SearchProductsDto): Promise<ProductSearchResult> {
    const manager = getTenantManager();
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = dto.status ?? 'active';

    const qb = manager.createQueryBuilder(Product, 'product');
    if (status !== 'all') {
      qb.andWhere('product.isActive = :isActive', { isActive: status === 'active' });
    }

    const term = dto.q?.trim();
    if (term) {
      const escaped = escapeLikePattern(term);
      qb.andWhere(
        new Brackets((where) => {
          where
            .where(`product.name ILIKE :contains ESCAPE '\\'`, { contains: `%${escaped}%` })
            .orWhere(`product.barcode LIKE :prefix ESCAPE '\\'`, { prefix: `${escaped}%` })
            .orWhere(`product.sku ILIKE :prefix ESCAPE '\\'`, { prefix: `${escaped}%` });
        }),
      );
    }

    if (dto.sort === 'updatedAt') {
      qb.orderBy('product.updatedAt', 'DESC');
    } else {
      qb.orderBy('product.name', 'ASC');
    }
    // Desempate estável: sem ele, itens com o mesmo nome/data podem pular ou repetir entre páginas.
    qb.addOrderBy('product.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async findByBarcode(barcode: string): Promise<Product> {
    const manager = getTenantManager();
    // Só ativos (F11): o app não pode registrar perda num produto arquivado.
    const product = await manager.findOne(Product, { where: { barcode, isActive: true } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado para este código de barras.');
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto, options: GateOptions = {}): Promise<Product | PendingApproval> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    const barcodeChanges = !!dto.barcode && dto.barcode !== product.barcode;
    if (barcodeChanges) {
      const existing = await manager.findOne(Product, {
        where: { companyId: companyId!, barcode: dto.barcode },
      });
      if (existing) {
        throw barcodeConflict(existing);
      }
    }

    const { justification, ...changes } = dto;
    if (!options.skipPolicy) {
      const policies = await loadCompanyPolicies();
      if (
        policies.price_change.enabled &&
        priceChangeExceeds(product, changes, policies.price_change.thresholdPercent)
      ) {
        const pending = await applyApprovalGate({
          policy: 'price_change',
          entityType: 'product',
          entityId: product.id,
          entityLabel: product.name,
          operation: 'update',
          payload: { ...changes },
          snapshot: productSnapshot(product),
          justification,
        });
        if (pending) return pending;
      }
    }

    if (barcodeChanges) product.barcode = dto.barcode!;
    if (changes.name !== undefined) product.name = changes.name;
    if (changes.sku !== undefined) product.sku = changes.sku || null;
    if (changes.unitPrice !== undefined) product.unitPrice = changes.unitPrice;
    if (changes.costPrice !== undefined) product.costPrice = changes.costPrice;

    try {
      return await manager.save(product);
    } catch (error) {
      if (isBarcodeUniqueViolation(error)) throw barcodeConflict(null);
      throw error;
    }
  }

  /**
   * Linha do tempo de preços do produto (sub-etapa 1.2.4 exibe no painel): as últimas 100 mudanças,
   * da mais recente para a mais antiga. Só colunas explícitas do usuário (nome) — nunca a entidade
   * inteira, que carrega dados de autenticação.
   */
  async findPriceHistory(id: string): Promise<PriceHistoryEntry[]> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    const rows = await manager
      .createQueryBuilder(ProductPriceHistory, 'history')
      .leftJoin(User, 'changedBy', 'changedBy.id = history.changedByUserId')
      .select('history.id', 'id')
      .addSelect('history.unitPrice', 'unitPrice')
      .addSelect('history.costPrice', 'costPrice')
      .addSelect('history.validFrom', 'validFrom')
      .addSelect('history.source', 'source')
      .addSelect('history.changedByUserId', 'changedByUserId')
      .addSelect('changedBy.name', 'changedByName')
      .where('history.productId = :id', { id })
      .orderBy('history.validFrom', 'DESC')
      .addOrderBy('history.seq', 'DESC')
      .limit(PRICE_HISTORY_LIMIT)
      .getRawMany<{
        id: string;
        unitPrice: string;
        costPrice: string;
        validFrom: Date;
        source: PriceChangeSource;
        changedByUserId: string | null;
        changedByName: string | null;
      }>();

    return rows.map((row) => ({
      ...row,
      unitPrice: Number(row.unitPrice),
      costPrice: Number(row.costPrice),
      changedByName: row.changedByName ?? null,
    }));
  }

  /** Reativa um produto arquivado (F2). Idempotente: reativar um produto ativo só o devolve. */
  async restore(id: string): Promise<Product> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }
    if (product.isActive) return product;
    product.isActive = true;
    return manager.save(product);
  }

  /** Prévia da correção retroativa (SP2, 2.3): quantas perdas e os totais antes/depois. */
  async retroFixPreview(id: string, query: RetroFixQueryDto): Promise<RetroFixImpact> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    const window = resolveRetroFixWindow(query.from, query.to, new Date());
    return computeRetroFixImpact(manager, id, window, query.unitPrice, query.costPrice);
  }

  /**
   * Corrige o valor congelado das perdas do produto na janela (SP2, 2.3). Justificativa sempre obrigatória
   * (DTO); com a política retro_fix ligada passa pelo portão de aprovação. Grava em modo resumo — nenhuma linha
   * de auditoria por perda — e registra UM evento retro_fix com o resumo. Não toca no histórico de preço nem no
   * preço atual do produto.
   */
  async retroFix(id: string, dto: RetroFixDto, options: GateOptions = {}): Promise<RetroFixImpact | PendingApproval> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado.');

    const window = resolveRetroFixWindow(dto.from, dto.to, new Date());
    const impact = await computeRetroFixImpact(manager, id, window, dto.unitPrice, dto.costPrice);

    if (!options.skipPolicy) {
      const policies = await loadCompanyPolicies();
      if (policies.retro_fix.enabled) {
        const pending = await applyApprovalGate({
          policy: 'retro_fix',
          entityType: 'product',
          entityId: product.id,
          entityLabel: product.name,
          operation: 'retro_fix',
          payload: {
            from: window.from.toISOString(),
            to: window.to.toISOString(),
            unitPrice: dto.unitPrice,
            costPrice: dto.costPrice,
          },
          snapshot: retroFixSnapshot(impact),
          justification: dto.justification,
        });
        if (pending) return pending;
      }
    }

    await manager.query(
      `SELECT set_config('app.audit_reason', $1, true), set_config('app.audit_mode', 'summary', true)`,
      [dto.justification],
    );
    await manager.query(
      `UPDATE losses SET "unitPriceAtLoss" = $2, "unitCostAtLoss" = $3, "valuationSource" = 'recalculated'
        WHERE "productId" = $1 AND "occurredAt" BETWEEN $4 AND $5`,
      [id, dto.unitPrice, dto.costPrice, window.from, window.to],
    );
    await recordAuditEvent(manager, {
      companyId: companyId!,
      entityType: 'product',
      entityId: product.id,
      entityLabel: product.name,
      action: 'retro_fix',
      summary: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        unitPrice: dto.unitPrice,
        costPrice: dto.costPrice,
        ...impact,
      },
    });
    return impact;
  }

  // Exclusão lógica (isActive = false): produtos já referenciados em perdas
  // registradas (Loss.productId tem onDelete RESTRICT) não podem ser apagados
  // de verdade sem quebrar o histórico de relatórios. Arquivar produto COM perdas pode exigir
  // justificativa/aprovação (política archive_with_history, SP2).
  async remove(id: string, justification?: string, options: GateOptions = {}): Promise<PendingApproval | void> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }
    if (!options.skipPolicy && product.isActive) {
      const policies = await loadCompanyPolicies();
      if (policies.archive_with_history.enabled && (await manager.count(Loss, { where: { productId: id } })) > 0) {
        const pending = await applyApprovalGate({
          policy: 'archive_with_history',
          entityType: 'product',
          entityId: product.id,
          entityLabel: product.name,
          operation: 'archive',
          payload: {},
          snapshot: productSnapshot(product),
          justification,
        });
        if (pending) return pending;
      }
    }
    product.isActive = false;
    await manager.save(product);
  }
}

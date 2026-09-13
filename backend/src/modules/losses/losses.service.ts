import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Between } from 'typeorm';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { CompanyMonthlyRevenue } from '../company-revenue/company-monthly-revenue.entity';
import { LossLocation } from '../loss-locations/loss-location.entity';
import { LossReason } from '../loss-reasons/loss-reason.entity';
import { Product } from '../products/product.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateLossDto } from './dto/create-loss.dto';
import { QueryLossesDto } from './dto/query-losses.dto';
import { UpdateLossDto } from './dto/update-loss.dto';
import { Loss } from './loss.entity';
import { computeLossAlerts, type LossAlert } from './losses-alerts';
import { projectMonthEnd } from './losses-projection';
import { computeShrinkageRate } from './losses-shrinkage';

@Injectable()
export class LossesService {
  /**
   * Idempotente por design (Seção 4.2 do documento): se o app reenviar o mesmo
   * clientGeneratedId (por exemplo, após uma queda de conexão no meio do envio),
   * devolvemos o registro já existente em vez de criar duplicata ou lançar erro
   * — o app não precisa de lógica especial para tratar "já enviei isso antes".
   */
  async create(dto: CreateLossDto): Promise<Loss> {
    const { companyId, userId } = getTenantContext();
    const manager = getTenantManager();

    const existing = await manager.findOne(Loss, {
      where: { companyId: companyId!, clientGeneratedId: dto.clientGeneratedId },
    });
    if (existing) return existing;

    const product = await manager.findOne(Product, { where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Produto informado não existe para esta empresa.');

    const reason = await manager.findOne(LossReason, { where: { id: dto.reasonId } });
    if (!reason) throw new NotFoundException('Motivo informado não existe para esta empresa.');

    const location = await manager.findOne(LossLocation, { where: { id: dto.locationId } });
    if (!location) throw new NotFoundException('Local informado não existe para esta empresa.');

    const loss = manager.create(Loss, {
      companyId: companyId!,
      clientGeneratedId: dto.clientGeneratedId,
      productId: dto.productId,
      reportedByUserId: userId,
      quantity: dto.quantity ?? 1,
      locationId: dto.locationId,
      reasonId: dto.reasonId,
      description: dto.description || null,
      imageUrl: dto.imageUrl ?? null,
      occurredAt: new Date(dto.occurredAt),
      source: dto.source ?? null,
    });
    return manager.save(loss);
  }

  /**
   * Edição manual pelo gerente (correção de erro de digitação, motivo errado
   * etc.) — os mesmos campos do formulário de registro, exceto os que são
   * fixados na criação (clientGeneratedId, reportedByUserId, source).
   */
  async update(id: string, dto: UpdateLossDto): Promise<Loss> {
    const manager = getTenantManager();
    const loss = await manager.findOne(Loss, { where: { id } });
    if (!loss) throw new NotFoundException('Perda não encontrada.');

    if (dto.productId !== undefined) {
      const product = await manager.findOne(Product, { where: { id: dto.productId } });
      if (!product) throw new NotFoundException('Produto informado não existe para esta empresa.');
      loss.productId = dto.productId;
    }
    if (dto.reasonId !== undefined) {
      const reason = await manager.findOne(LossReason, { where: { id: dto.reasonId } });
      if (!reason) throw new NotFoundException('Motivo informado não existe para esta empresa.');
      loss.reasonId = dto.reasonId;
    }
    if (dto.locationId !== undefined) {
      const location = await manager.findOne(LossLocation, { where: { id: dto.locationId } });
      if (!location) throw new NotFoundException('Local informado não existe para esta empresa.');
      loss.locationId = dto.locationId;
    }
    if (dto.quantity !== undefined) loss.quantity = dto.quantity;
    if (dto.description !== undefined) loss.description = dto.description || null;
    if (dto.occurredAt !== undefined) loss.occurredAt = new Date(dto.occurredAt);

    return manager.save(loss);
  }

  // Nenhuma outra tabela referencia losses (é um registro-folha), então a
  // exclusão é direta — sem a nuance de FK RESTRICT usada em produtos/usuários.
  async remove(id: string): Promise<void> {
    const manager = getTenantManager();
    const result = await manager.delete(Loss, id);
    if (result.affected === 0) {
      throw new NotFoundException('Perda não encontrada.');
    }
  }

  findAll(query: QueryLossesDto): Promise<Loss[]> {
    const manager = getTenantManager();
    const where =
      query.from && query.to ? { occurredAt: Between(new Date(query.from), new Date(query.to)) } : {};
    return manager.find(Loss, {
      where,
      relations: { product: true, reportedBy: true, reason: true, location: true },
      order: { occurredAt: 'DESC' },
      take: 500,
    });
  }

  /**
   * Base dos gráficos gerenciais citados na funcionalidade 2 do documento:
   * produtos mais perdidos e prejuízo financeiro estimado (quantidade x preço
   * unitário do produto no momento da consulta).
   */
  async reportByProduct(query: QueryLossesDto) {
    const manager = getTenantManager();
    const qb = manager
      .createQueryBuilder(Loss, 'loss')
      .innerJoin(Product, 'product', 'product.id = loss.productId')
      .select('product.id', 'productId')
      .addSelect('product.name', 'productName')
      .addSelect('SUM(loss.quantity)', 'totalQuantity')
      .addSelect('SUM(loss.quantity * product.unitPrice)', 'totalFinancialLoss')
      .addSelect('SUM(loss.quantity * product.costPrice)', 'totalCostLoss')
      .groupBy('product.id')
      .addGroupBy('product.name')
      .orderBy('"totalFinancialLoss"', 'DESC');

    if (query.from && query.to) {
      qb.andWhere('loss.occurredAt BETWEEN :from AND :to', { from: query.from, to: query.to });
    }

    return qb.getRawMany();
  }

  /**
   * KPIs do topo do dashboard: prejuízo e quantidade do mês corrente vs mês
   * anterior (sempre calendário, independente do filtro de período das outras
   * seções da tela), com a variação percentual já calculada.
   */
  async reportSummary() {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Sequencial de propósito: as duas consultas dividem o mesmo QueryRunner
    // (uma conexão/transação por requisição — ver TenantContextMiddleware),
    // que não suporta duas queries concorrentes.
    const currentMonth = await this.sumRange(startOfCurrentMonth, now);
    const previousMonth = await this.sumRange(startOfPreviousMonth, startOfCurrentMonth);

    const financialVariationPercent =
      previousMonth.totalFinancialLoss === 0
        ? null
        : ((currentMonth.totalFinancialLoss - previousMonth.totalFinancialLoss) /
            previousMonth.totalFinancialLoss) *
          100;

    const costVariationPercent =
      previousMonth.totalCostLoss === 0
        ? null
        : ((currentMonth.totalCostLoss - previousMonth.totalCostLoss) / previousMonth.totalCostLoss) * 100;

    const projectedMonthEnd = projectMonthEnd(currentMonth, previousMonth, now);

    const manager = getTenantManager();
    const revenue = await manager.findOne(CompanyMonthlyRevenue, {
      where: { year: now.getFullYear(), month: now.getMonth() + 1 },
    });
    const shrinkageRate = computeShrinkageRate(
      currentMonth.totalFinancialLoss,
      revenue ? Number(revenue.revenueAmount) : null,
    );

    return {
      currentMonth,
      previousMonth,
      financialVariationPercent,
      costVariationPercent,
      projectedMonthEnd,
      shrinkageRate,
    };
  }

  private async sumRange(from: Date, to: Date) {
    const manager = getTenantManager();
    const raw = await manager
      .createQueryBuilder(Loss, 'loss')
      .innerJoin(Product, 'product', 'product.id = loss.productId')
      .select('COALESCE(SUM(loss.quantity), 0)', 'totalQuantity')
      .addSelect('COALESCE(SUM(loss.quantity * product.unitPrice), 0)', 'totalFinancialLoss')
      .addSelect('COALESCE(SUM(loss.quantity * product.costPrice), 0)', 'totalCostLoss')
      .where('loss.occurredAt >= :from AND loss.occurredAt < :to', { from, to })
      .getRawOne<{ totalQuantity: string; totalFinancialLoss: string; totalCostLoss: string }>();
    return {
      totalQuantity: Number(raw?.totalQuantity ?? 0),
      totalFinancialLoss: Number(raw?.totalFinancialLoss ?? 0),
      totalCostLoss: Number(raw?.totalCostLoss ?? 0),
    };
  }

  /**
   * Série temporal do prejuízo financeiro — alimenta o gráfico de
   * tendência/área do dashboard. Sem from/to, usa os últimos 30 dias.
   */
  async reportByPeriod(query: QueryLossesDto) {
    const manager = getTenantManager();
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    const qb = manager
      .createQueryBuilder(Loss, 'loss')
      .innerJoin(Product, 'product', 'product.id = loss.productId')
      .select("DATE_TRUNC('day', loss.occurredAt)", 'date')
      .addSelect('SUM(loss.quantity)', 'totalQuantity')
      .addSelect('SUM(loss.quantity * product.unitPrice)', 'totalFinancialLoss')
      .where('loss.occurredAt BETWEEN :from AND :to', { from, to })
      .groupBy("DATE_TRUNC('day', loss.occurredAt)")
      .orderBy("DATE_TRUNC('day', loss.occurredAt)", 'ASC');

    return qb.getRawMany();
  }

  /** Composição das perdas por motivo — alimenta o gráfico de rosca. */
  async reportByReason(query: QueryLossesDto) {
    const manager = getTenantManager();
    const qb = manager
      .createQueryBuilder(Loss, 'loss')
      .innerJoin(Product, 'product', 'product.id = loss.productId')
      .innerJoin(LossReason, 'reason', 'reason.id = loss.reasonId')
      .select('reason.id', 'id')
      .addSelect('reason.name', 'label')
      .addSelect('SUM(loss.quantity)', 'totalQuantity')
      .addSelect('SUM(loss.quantity * product.unitPrice)', 'totalFinancialLoss')
      .groupBy('reason.id')
      .addGroupBy('reason.name')
      .orderBy('"totalFinancialLoss"', 'DESC');

    if (query.from && query.to) {
      qb.andWhere('loss.occurredAt BETWEEN :from AND :to', { from: query.from, to: query.to });
    }

    return qb.getRawMany();
  }

  /** Composição das perdas por local — segunda visão do gráfico de rosca. */
  async reportByLocation(query: QueryLossesDto) {
    const manager = getTenantManager();
    const qb = manager
      .createQueryBuilder(Loss, 'loss')
      .innerJoin(Product, 'product', 'product.id = loss.productId')
      .innerJoin(LossLocation, 'location', 'location.id = loss.locationId')
      .select('location.id', 'id')
      .addSelect('location.name', 'label')
      .addSelect('SUM(loss.quantity)', 'totalQuantity')
      .addSelect('SUM(loss.quantity * product.unitPrice)', 'totalFinancialLoss')
      .groupBy('location.id')
      .addGroupBy('location.name')
      .orderBy('"totalFinancialLoss"', 'DESC');

    if (query.from && query.to) {
      qb.andWhere('loss.occurredAt BETWEEN :from AND :to', { from: query.from, to: query.to });
    }

    return qb.getRawMany();
  }

  /**
   * Exportação de planilha (Seção 5.3 do documento): gera o arquivo com os
   * dados já no formato que o gerente normalmente precisa para dar baixa no
   * ERP principal da empresa. Síncrono aqui por simplicidade — para volumes
   * muito grandes, o mesmo padrão assíncrono da importação (fila + job) se
   * aplicaria da mesma forma.
   */
  async exportToXlsx(query: QueryLossesDto): Promise<Buffer> {
    const losses = await this.findAll(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Perdas');
    sheet.columns = [
      { header: 'Data/hora da ocorrência', key: 'occurredAt', width: 22 },
      { header: 'Código de barras', key: 'barcode', width: 20 },
      { header: 'Produto', key: 'productName', width: 30 },
      { header: 'Quantidade', key: 'quantity', width: 14 },
      { header: 'Preço unitário', key: 'unitPrice', width: 16 },
      { header: 'Prejuízo estimado', key: 'financialLoss', width: 18 },
      { header: 'Motivo', key: 'reason', width: 20 },
      { header: 'Local', key: 'location', width: 22 },
      { header: 'Descrição', key: 'description', width: 40 },
      { header: 'Registrado por', key: 'reportedBy', width: 24 },
    ];

    for (const loss of losses) {
      const unitPrice = Number(loss.product?.unitPrice ?? 0);
      const quantity = Number(loss.quantity);
      sheet.addRow({
        occurredAt: loss.occurredAt,
        barcode: loss.product?.barcode ?? '',
        productName: loss.product?.name ?? '',
        quantity,
        unitPrice,
        financialLoss: Number((unitPrice * quantity).toFixed(2)),
        reason: loss.reason?.name ?? '',
        location: loss.location?.name ?? '',
        description: loss.description,
        reportedBy: loss.reportedBy?.name ?? '',
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Card "Alertas e recomendações" do dashboard: roda o catálogo fixo de
   * regras (losses-alerts.ts) sobre os últimos 30 dias, comparando com os 30
   * dias anteriores quando a regra precisa de tendência. Consultas
   * sequenciais de propósito — mesmo motivo do reportSummary acima (uma
   * conexão por requisição, sem suporte a queries concorrentes).
   */
  async reportAlerts(): Promise<LossAlert[]> {
    const manager = getTenantManager();
    const now = new Date();
    const currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const currentLosses = await manager.find(Loss, {
      where: { occurredAt: Between(currentStart, now) },
      relations: { product: true, reason: true, location: true, reportedBy: true },
    });

    const previousLosses = await manager.find(Loss, {
      where: { occurredAt: Between(previousStart, currentStart) },
      relations: { product: true, reason: true },
    });

    const monthSummary = await this.reportSummary();

    const activeEmployeeCount = await manager.count(User, {
      where: { role: UserRole.EMPLOYEE, isActive: true },
    });

    // Últimos 3 meses de calendário, do mais recente ao mais antigo — usado
    // pela regra de ofensor recorrente.
    const monthStarts = [0, 1, 2, 3].map((offset) => new Date(now.getFullYear(), now.getMonth() - offset, 1));
    const top3CurrentMonth = await this.topProductIdsInRange(monthStarts[0], now, 3);
    const top3PreviousMonth1 = await this.topProductIdsInRange(monthStarts[1], monthStarts[0], 3);
    const top3PreviousMonth2 = await this.topProductIdsInRange(monthStarts[2], monthStarts[1], 3);

    return computeLossAlerts({
      currentLosses,
      previousLosses,
      monthSummary,
      activeEmployeeCount,
      recentTop3ByMonth: [top3CurrentMonth, top3PreviousMonth1, top3PreviousMonth2],
      now,
    });
  }

  private async topProductIdsInRange(from: Date, to: Date, limit: number): Promise<{ id: string; name: string }[]> {
    const manager = getTenantManager();
    const rows = await manager
      .createQueryBuilder(Loss, 'loss')
      .innerJoin(Product, 'product', 'product.id = loss.productId')
      .select('product.id', 'id')
      .addSelect('product.name', 'name')
      .addSelect('SUM(loss.quantity * product.unitPrice)', 'total')
      .where('loss.occurredAt BETWEEN :from AND :to', { from, to })
      .groupBy('product.id')
      .addGroupBy('product.name')
      .orderBy('"total"', 'DESC')
      .limit(limit)
      .getRawMany<{ id: string; name: string; total: string }>();
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }
}

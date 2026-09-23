import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { getTenantContext, getTenantManager } from '../../common/tenant/tenant-storage';
import { User } from '../users/user.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { SearchProductsDto } from './dto/search-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { barcodeConflict, isBarcodeUniqueViolation } from './product-errors';
import { Product } from './product.entity';
import { DEFAULT_PAGE_SIZE, escapeLikePattern, ProductSearchResult } from './products-search';
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

/**
 * Nenhum método aqui filtra manualmente por companyId — a Row Level Security
 * do PostgreSQL (migration InitialSchema) já garante isso na conexão aberta
 * pelo TenantContextMiddleware. Definir companyId explicitamente no INSERT
 * (abaixo) ainda é necessário porque a política WITH CHECK exige que o valor
 * gravado bata com app.current_company_id — é a segunda camada de defesa
 * descrita na Seção 1.2 do documento, não uma substituição da primeira.
 */
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

  findAll(sinceIso?: string): Promise<Product[]> {
    const manager = getTenantManager();
    if (sinceIso) {
      // Sincronização incremental (Seção 4.3 do documento): o app pergunta
      // "o que mudou desde X" em vez de baixar o catálogo inteiro toda vez.
      return manager
        .createQueryBuilder(Product, 'product')
        .where('product.isActive = true')
        .andWhere('product.updatedAt > :since', { since: new Date(sinceIso) })
        .orderBy('product.updatedAt', 'ASC')
        .getMany();
    }
    return manager.find(Product, { where: { isActive: true }, order: { name: 'ASC' } });
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

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const { companyId } = getTenantContext();
    const manager = getTenantManager();

    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    if (dto.barcode && dto.barcode !== product.barcode) {
      const existing = await manager.findOne(Product, {
        where: { companyId: companyId!, barcode: dto.barcode },
      });
      if (existing) {
        throw new ConflictException('Já existe um produto com este código de barras.');
      }
      product.barcode = dto.barcode;
    }
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.sku !== undefined) product.sku = dto.sku || null;
    if (dto.unitPrice !== undefined) product.unitPrice = dto.unitPrice;
    if (dto.costPrice !== undefined) product.costPrice = dto.costPrice;

    return manager.save(product);
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

  // Exclusão lógica (isActive = false): produtos já referenciados em perdas
  // registradas (Loss.productId tem onDelete RESTRICT) não podem ser apagados
  // de verdade sem quebrar o histórico de relatórios.
  async remove(id: string): Promise<void> {
    const manager = getTenantManager();
    const product = await manager.findOne(Product, { where: { id } });
    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }
    product.isActive = false;
    await manager.save(product);
  }
}

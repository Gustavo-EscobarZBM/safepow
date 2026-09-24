import { Company } from '../modules/companies/company.entity';
import { CompanyMonthlyRevenue } from '../modules/company-revenue/company-monthly-revenue.entity';
import { ImportJob } from '../modules/imports/import-job.entity';
import { Loss } from '../modules/losses/loss.entity';
import { LossLocation } from '../modules/loss-locations/loss-location.entity';
import { LossReason } from '../modules/loss-reasons/loss-reason.entity';
import { ProductPriceHistory } from '../modules/products/product-price-history.entity';
import { Product } from '../modules/products/product.entity';
import { User } from '../modules/users/user.entity';
import { AuditLog } from '../modules/audit/audit-log.entity';

/**
 * Única lista de entidades do TypeORM, importada por app.module.ts (conexão de runtime),
 * data-source.ts (CLI de migrations) e pelo harness de testes de integração
 * (test-utils/test-db.ts). Antes desta etapa havia 3 cópias manuais; data-source.ts já tinha
 * ficado defasada (faltava CompanyMonthlyRevenue) — ver "Pendências" da etapa 1.1 no spec do SP1.
 * Ao criar uma entidade nova (ex.: ProductPriceHistory na sub-etapa 1.2.2), acrescente aqui.
 */
export const ENTITIES = [
  Company,
  User,
  Product,
  Loss,
  ImportJob,
  LossReason,
  LossLocation,
  CompanyMonthlyRevenue,
  ProductPriceHistory,
  AuditLog,
];

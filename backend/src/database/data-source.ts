import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Company } from '../modules/companies/company.entity';
import { User } from '../modules/users/user.entity';
import { Product } from '../modules/products/product.entity';
import { LossLocation } from '../modules/loss-locations/loss-location.entity';
import { LossReason } from '../modules/loss-reasons/loss-reason.entity';
import { Loss } from '../modules/losses/loss.entity';
import { ImportJob } from '../modules/imports/import-job.entity';

dotenv.config();

// Usado pela CLI do TypeORM (migration:run / migration:generate). Conecta com o
// role ADMINISTRADOR (dono das tabelas) porque criar/alterar tabelas e políticas
// de RLS exige privilégios que o role de runtime da aplicação (DB_APP_USER)
// deliberadamente não tem. Ver docker/init-db/001-create-app-role.sql.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_ADMIN_USER || 'postgres',
  password: process.env.DB_ADMIN_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'inventory_saas',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [Company, User, Product, Loss, ImportJob, LossReason, LossLocation],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false, // NUNCA true em produção — sempre via migrations controladas.
  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;

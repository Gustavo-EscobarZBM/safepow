import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { Company } from './modules/companies/company.entity';
import { CompaniesModule } from './modules/companies/companies.module';
import { ImportJob } from './modules/imports/import-job.entity';
import { ImportsModule } from './modules/imports/imports.module';
import { CompanyMonthlyRevenue } from './modules/company-revenue/company-monthly-revenue.entity';
import { LossLocation } from './modules/loss-locations/loss-location.entity';
import { LossLocationsModule } from './modules/loss-locations/loss-locations.module';
import { LossReason } from './modules/loss-reasons/loss-reason.entity';
import { LossReasonsModule } from './modules/loss-reasons/loss-reasons.module';
import { Loss } from './modules/losses/loss.entity';
import { LossesModule } from './modules/losses/losses.module';
import { Product } from './modules/products/product.entity';
import { ProductsModule } from './modules/products/products.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { User } from './modules/users/user.entity';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Conexão de RUNTIME da aplicação — usa o role restrito (DB_APP_USER), não
    // o role administrador das migrations. É esta conexão que respeita a RLS.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_APP_USER'),
        password: config.get<string>('DB_APP_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        entities: [Company, User, Product, Loss, ImportJob, LossReason, LossLocation, CompanyMonthlyRevenue],
        synchronize: false,
        logging: config.get<string>('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
      }),
    }),

    // Fila da importação de planilhas (Seção 5.2 do documento) — reaproveita
    // o mesmo Redis previsto na arquitetura para cache/filas (Seção 2.3).
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),

    // Módulo global do JwtService, usado tanto pelo AuthModule quanto pelo
    // TenantContextMiddleware para verificar o token a cada requisição.
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '8h') },
      }),
    }),

    AuthModule,
    CompaniesModule,
    ProductsModule,
    LossReasonsModule,
    LossLocationsModule,
    LossesModule,
    UsersModule,
    UploadsModule,
    ImportsModule,
    BillingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}

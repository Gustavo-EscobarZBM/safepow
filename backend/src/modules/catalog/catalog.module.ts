import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { Brand } from './brand.entity';
import { BrandsController } from './brands.controller';
import { BrandsService, SuppliersService } from './brands-suppliers.services';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { Category } from './category.entity';
import { Supplier } from './supplier.entity';
import { SuppliersController } from './suppliers.controller';

export const CATALOG_PROVIDERS = [CategoriesService, BrandsService, SuppliersService];

// Taxonomias do catálogo de produtos (SP4 4.1). Company: o SubscriptionGuard injeta o repositório.
@Module({
  imports: [TypeOrmModule.forFeature([Category, Brand, Supplier, Company])],
  controllers: [CategoriesController, BrandsController, SuppliersController],
  providers: CATALOG_PROVIDERS,
  exports: CATALOG_PROVIDERS,
})
export class CatalogModule {}

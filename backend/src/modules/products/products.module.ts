import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product } from './product.entity';

@Module({
  // Company precisa estar registrada aqui porque o SubscriptionGuard (usado no
  // controller) injeta o repositório de Company.
  imports: [TypeOrmModule.forFeature([Product, Company])],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

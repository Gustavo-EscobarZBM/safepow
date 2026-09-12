import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { BillingController } from './billing.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [BillingController],
})
export class BillingModule {}

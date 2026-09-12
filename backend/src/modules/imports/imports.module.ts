import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { Product } from '../products/product.entity';
import { UploadsModule } from '../uploads/uploads.module';
import { ImportJob } from './import-job.entity';
import { ImportsController } from './imports.controller';
import { ImportsProcessor } from './imports.processor';
import { ImportsService, PRODUCTS_IMPORT_QUEUE } from './imports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJob, Product, Company]),
    BullModule.registerQueue({ name: PRODUCTS_IMPORT_QUEUE }),
    UploadsModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsProcessor],
})
export class ImportsModule {}

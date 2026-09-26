import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { Product } from '../products/product.entity';
import { UploadsModule } from '../uploads/uploads.module';
import { ImportJob } from './import-job.entity';
import { ImportJobsController } from './import-jobs.controller';
import { IMPORTS_QUEUE, ImportJobsService } from './import-jobs.service';
import { ImportMappingsController } from './import-mappings.controller';
import { ImportMappingsService } from './import-mappings.service';
import { ImportsQueueProcessor } from './imports-queue.processor';
import { ImportsController } from './imports.controller';
import { ImportsProcessor } from './imports.processor';
import { ImportsService, PRODUCTS_IMPORT_QUEUE } from './imports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJob, Product, Company]),
    BullModule.registerQueue({ name: PRODUCTS_IMPORT_QUEUE }, { name: IMPORTS_QUEUE }),
    UploadsModule,
  ],
  controllers: [ImportsController, ImportJobsController, ImportMappingsController],
  providers: [ImportsService, ImportsProcessor, ImportJobsService, ImportMappingsService, ImportsQueueProcessor],
})
export class ImportsModule {}

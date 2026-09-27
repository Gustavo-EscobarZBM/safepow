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

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJob, Product, Company]),
    BullModule.registerQueue({ name: IMPORTS_QUEUE }),
    UploadsModule,
  ],
  controllers: [ImportJobsController, ImportMappingsController],
  providers: [ImportJobsService, ImportMappingsService, ImportsQueueProcessor],
  exports: [ImportJobsService],
})
export class ImportsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { StorageService } from './storage.service';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Company])], // Company é usado pelo SubscriptionGuard
  controllers: [UploadsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class UploadsModule {}

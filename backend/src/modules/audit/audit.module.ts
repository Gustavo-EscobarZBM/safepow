import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { AuditController } from './audit.controller';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

@Module({
  // Company: exigida pelo SubscriptionGuard do controller.
  imports: [TypeOrmModule.forFeature([AuditLog, Company])],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}

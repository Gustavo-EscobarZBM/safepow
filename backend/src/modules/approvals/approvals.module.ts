import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { LossesModule } from '../losses/losses.module';
import { ProductsModule } from '../products/products.module';
import { ApprovalPoliciesController } from './approval-policies.controller';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ChangeRequest } from './change-request.entity';

@Module({
  // Company: exigida pelo SubscriptionGuard. Produtos e Perdas: a aprovação reaplica pelos mesmos serviços.
  imports: [TypeOrmModule.forFeature([ChangeRequest, Company]), ProductsModule, LossesModule],
  controllers: [ApprovalsController, ApprovalPoliciesController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}

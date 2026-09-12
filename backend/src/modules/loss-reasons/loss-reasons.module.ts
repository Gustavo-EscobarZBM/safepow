import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { LossReason } from './loss-reason.entity';
import { LossReasonsController } from './loss-reasons.controller';
import { LossReasonsService } from './loss-reasons.service';

@Module({
  // Company precisa estar registrada aqui porque o SubscriptionGuard (usado no
  // controller) injeta o repositório de Company.
  imports: [TypeOrmModule.forFeature([LossReason, Company])],
  controllers: [LossReasonsController],
  providers: [LossReasonsService],
  exports: [LossReasonsService],
})
export class LossReasonsModule {}

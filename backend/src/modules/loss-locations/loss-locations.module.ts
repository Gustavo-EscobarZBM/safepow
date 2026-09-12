import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { LossLocation } from './loss-location.entity';
import { LossLocationsController } from './loss-locations.controller';
import { LossLocationsService } from './loss-locations.service';

@Module({
  // Company precisa estar registrada aqui porque o SubscriptionGuard (usado no
  // controller) injeta o repositório de Company.
  imports: [TypeOrmModule.forFeature([LossLocation, Company])],
  controllers: [LossLocationsController],
  providers: [LossLocationsService],
  exports: [LossLocationsService],
})
export class LossLocationsModule {}

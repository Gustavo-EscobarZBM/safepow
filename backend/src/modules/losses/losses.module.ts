import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { Loss } from './loss.entity';
import { LossesController } from './losses.controller';
import { LossesService } from './losses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Loss, Company])],
  controllers: [LossesController],
  providers: [LossesService],
  exports: [LossesService],
})
export class LossesModule {}

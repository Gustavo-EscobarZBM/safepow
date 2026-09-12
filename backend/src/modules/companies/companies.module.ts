import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { Company } from './company.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Company, User])],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService, TypeOrmModule],
})
export class CompaniesModule {}

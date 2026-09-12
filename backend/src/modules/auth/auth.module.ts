import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/company.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// O JwtService já é fornecido globalmente pelo JwtModule registrado em
// AppModule (necessário também para o TenantContextMiddleware verificar o
// token a cada requisição) — este módulo só injeta o que falta para o login.
// Company é usado pelo AuthService para checar o status da empresa (bloqueio
// no login) antes de emitir o token.
@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}

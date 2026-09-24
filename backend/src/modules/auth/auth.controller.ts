import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip?.replace(/^::ffff:/, '');
    return this.authService.login(dto.email, dto.password, {
      ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { UserRole } from '../users/user.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Cadastro manual de produto — usado pelo painel do gerente (cadastro unitário)
  // ou pela importação de planilha (o worker de importação chama o mesmo service).
  @Post()
  @Roles(UserRole.MANAGER)
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  // Consultado tanto pelo painel (listagem) quanto pelo app (sincronização de
  // catálogo). Aceita ?since=ISO_DATE para sincronização incremental (Seção 4.3).
  @Get()
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  findAll(@Query('since') since?: string) {
    return this.productsService.findAll(since);
  }

  // Usado pelo app ao escanear um código de barras (funcionalidade 1 do documento).
  @Get('barcode/:barcode')
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  findByBarcode(@Param('barcode') barcode: string) {
    return this.productsService.findByBarcode(barcode);
  }

  // Linha do tempo de preços do produto (valor congelado das perdas — SP1, sub-etapa 1.2.3).
  @Get(':id/price-history')
  @Roles(UserRole.MANAGER)
  findPriceHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findPriceHistory(id);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  // Reativa um produto arquivado (o "Excluir" do painel arquiva — ver remove()).
  @Patch(':id/restore')
  @Roles(UserRole.MANAGER)
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.restore(id);
  }

  // Exclusão lógica — ver nota em ProductsService.remove().
  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }
}

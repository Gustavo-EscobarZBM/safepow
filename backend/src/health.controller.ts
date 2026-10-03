import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { getTenantManager } from './common/tenant/tenant-storage';

@Controller('health')
export class HealthController {
  @Get()
  async check() {
    try {
      // Consulta sem dados de clientes; exige tabelas, colunas e permissoes de runtime.
      await getTenantManager().query('SELECT "unitPriceAtLoss", "unitCostAtLoss" FROM losses LIMIT 0');
      await getTenantManager().query('SELECT "categoryId", "unit", "reviewStatus" FROM products LIMIT 0');
      return { status: 'ok', service: 'safepow-api' };
    } catch {
      throw new ServiceUnavailableException('Banco indisponível ou instalação incompleta.');
    }
  }
}

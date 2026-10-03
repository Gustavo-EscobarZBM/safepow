import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { getTenantManager } from './common/tenant/tenant-storage';

jest.mock('./common/tenant/tenant-storage', () => ({ getTenantManager: jest.fn() }));

describe('HealthController', () => {
  it('confirma acesso ao schema pelo mesmo contexto de banco da API', async () => {
    const query = jest.fn().mockResolvedValue([]);
    (getTenantManager as jest.Mock).mockReturnValue({ query });
    await expect(new HealthController().check()).resolves.toEqual({ status: 'ok', service: 'safepow-api' });
    expect(query.mock.calls[0][0]).toContain('"unitPriceAtLoss"');
  });

  it('nao anuncia sucesso nem expoe detalhes quando o schema/banco falha', async () => {
    (getTenantManager as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('private connection details')) });
    await expect(new HealthController().check()).rejects.toThrow(ServiceUnavailableException);
    await expect(new HealthController().check()).rejects.toThrow('Banco indisponível ou instalação incompleta.');
  });
});

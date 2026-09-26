import { Inject } from '@nestjs/common';

/**
 * Substituto do @nestjs/bullmq nos testes (o pacote instalado é ESM e o Jest roda CommonJS). Uso no arquivo de
 * teste: `jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'))`. A fila vira um provider
 * comum com o token de `getQueueToken`, que o teste troca por uma fila falsa.
 */
export const Processor = () => () => undefined;
export const WorkerHost = class {};
export const getQueueToken = (name: string) => `BullQueue_${name}`;
export const InjectQueue = (name: string) => Inject(getQueueToken(name));
export const BullModule = {
  registerQueue: () => ({ module: class BullQueueMock {} }),
  forRootAsync: () => ({ module: class BullRootMock {} }),
};

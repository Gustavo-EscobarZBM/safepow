import { BadRequestException } from '@nestjs/common';
import { ImportResourceHandler } from '../engine/types';
import { productsImportHandler } from './products.import-handler';

/** Handlers de importação por recurso (SP3: produtos; SP4/SP7 acrescentam os seus aqui). */
const HANDLERS: Record<string, ImportResourceHandler<any>> = {
  products: productsImportHandler,
};

export function getImportHandler(resource: string): ImportResourceHandler<any> {
  const handler = HANDLERS[resource];
  if (!handler) throw new BadRequestException('Tipo de importação desconhecido.');
  return handler;
}

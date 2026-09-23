import { ConflictException, HttpStatus } from '@nestjs/common';
import { Product } from './product.entity';

/** Códigos estáveis que o painel usa para decidir o que oferecer (spec do SP1, seção 5.1). */
export const ProductErrorCode = {
  BARCODE_EXISTS: 'PRODUCT_BARCODE_EXISTS',
  ARCHIVED_EXISTS: 'PRODUCT_ARCHIVED_EXISTS',
} as const;

/** Nome do índice único (companyId, barcode) — migration InitialSchema. */
export const PRODUCT_BARCODE_UNIQUE_INDEX = 'uq_products_company_barcode';

/**
 * 409 do cadastro: produto ativo com o mesmo código ⇒ só avisa; ARQUIVADO ⇒ devolve o id para o painel
 * oferecer "Reativar e atualizar os dados" em vez de um beco sem saída (F2).
 */
export function barcodeConflict(existing: Pick<Product, 'id' | 'isActive'> | null): ConflictException {
  if (existing && !existing.isActive) {
    return new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      errorCode: ProductErrorCode.ARCHIVED_EXISTS,
      message: 'Existe um produto arquivado com este código de barras. Reative-o para voltar a usá-lo.',
      productId: existing.id,
    });
  }
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    errorCode: ProductErrorCode.BARCODE_EXISTS,
    message: 'Já existe um produto com este código de barras.',
  });
}

/** Violação do índice único de código de barras (cadastro concorrente que passou pela checagem prévia). */
export function isBarcodeUniqueViolation(error: unknown): boolean {
  const driverError = (error as { driverError?: { code?: string; constraint?: string } })?.driverError;
  return driverError?.code === '23505' && driverError.constraint === PRODUCT_BARCODE_UNIQUE_INDEX;
}

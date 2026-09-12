import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLossDto } from './create-loss.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateLossDto, payload);
  return validate(dto);
}

describe('CreateLossDto', () => {
  const validPayload = {
    clientGeneratedId: '550e8400-e29b-41d4-a716-446655440000',
    productId: '550e8400-e29b-41d4-a716-446655440001',
    quantity: 2,
    locationId: '550e8400-e29b-41d4-a716-446655440002',
    reasonId: '550e8400-e29b-41d4-a716-446655440003',
    description: 'Caixa amassada no transporte',
    occurredAt: new Date().toISOString(),
  };

  it('aceita um payload completo e válido', async () => {
    const errors = await validateDto(validPayload);
    expect(errors).toHaveLength(0);
  });

  it('rejeita quando falta o clientGeneratedId (essencial para a idempotência da Seção 4.2)', async () => {
    const { clientGeneratedId, ...rest } = validPayload;
    const errors = await validateDto(rest);
    expect(errors.some((e) => e.property === 'clientGeneratedId')).toBe(true);
  });

  it('rejeita clientGeneratedId que não seja um UUID', async () => {
    const errors = await validateDto({ ...validPayload, clientGeneratedId: 'não-é-um-uuid' });
    expect(errors.some((e) => e.property === 'clientGeneratedId')).toBe(true);
  });

  it('rejeita quando falta o locationId', async () => {
    const { locationId, ...rest } = validPayload;
    const errors = await validateDto(rest);
    expect(errors.some((e) => e.property === 'locationId')).toBe(true);
  });

  it('aceita sem description (campo passou a ser opcional no app mobile)', async () => {
    const { description, ...rest } = validPayload;
    const errors = await validateDto(rest);
    expect(errors).toHaveLength(0);
  });

  it('rejeita locationId que não seja um uuid (sem texto livre)', async () => {
    const errors = await validateDto({ ...validPayload, locationId: 'Depósito 2' });
    expect(errors.some((e) => e.property === 'locationId')).toBe(true);
  });

  it('rejeita quando falta o motivo da perda', async () => {
    const { reasonId, ...rest } = validPayload;
    const errors = await validateDto(rest);
    expect(errors.some((e) => e.property === 'reasonId')).toBe(true);
  });

  it('rejeita reasonId que não seja um uuid', async () => {
    const errors = await validateDto({ ...validPayload, reasonId: 'venceu ontem' });
    expect(errors.some((e) => e.property === 'reasonId')).toBe(true);
  });

  it('rejeita occurredAt que não seja uma data ISO válida', async () => {
    const errors = await validateDto({ ...validPayload, occurredAt: 'ontem' });
    expect(errors.some((e) => e.property === 'occurredAt')).toBe(true);
  });

  it('aceita sem quantity (assume o default 1 no service, não no DTO)', async () => {
    const { quantity, ...rest } = validPayload;
    const errors = await validateDto(rest);
    expect(errors).toHaveLength(0);
  });
});

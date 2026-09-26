import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { describeRequest, isPendingApproval, justificationRequired, modeDescription } from './approvals';
import type { ChangeRequest } from './types';

function request(overrides: Partial<ChangeRequest>): ChangeRequest {
  return {
    id: 'c1',
    policy: 'price_change',
    entityType: 'product',
    entityId: 'p1',
    entityLabel: 'Arroz',
    operation: 'update',
    payload: {},
    snapshot: {},
    justification: 'Fornecedor reajustou',
    status: 'pending',
    requestedByUserId: 'u1',
    requestedByName: 'Ana',
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    decisionNote: null,
    expiresAt: '2026-10-02T12:00:00.000Z',
    createdAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  };
}

describe('modeDescription', () => {
  it('1 gerente (ou nenhum) ⇒ justificativa; 2+ ⇒ aprovação', () => {
    expect(modeDescription(1)).toBe('Sua empresa tem 1 gerente ativo: as mudanças sensíveis pedirão justificativa.');
    expect(modeDescription(3)).toBe(
      'Sua empresa tem 3 gerentes ativos: as mudanças sensíveis vão para aprovação de outro gerente.',
    );
    expect(modeDescription(0)).toBe('Sua empresa tem 0 gerentes ativos: as mudanças sensíveis pedirão justificativa.');
  });
});

describe('justificationRequired', () => {
  it('reconhece o 409 JUSTIFICATION_REQUIRED', () => {
    const error = new ApiError(409, 'msg', { errorCode: 'JUSTIFICATION_REQUIRED', policy: 'price_change', mode: 'approval' });
    expect(justificationRequired(error)).toEqual({ policy: 'price_change', mode: 'approval', message: 'msg' });
  });

  it('ignora outros erros', () => {
    expect(justificationRequired(new ApiError(409, 'x', { errorCode: 'PRODUCT_BARCODE_TAKEN' }))).toBeNull();
    expect(justificationRequired(new ApiError(400, 'x', { errorCode: 'JUSTIFICATION_REQUIRED' }))).toBeNull();
    expect(justificationRequired(new Error('x'))).toBeNull();
  });
});

describe('isPendingApproval', () => {
  it('só o 202 pendente', () => {
    expect(isPendingApproval({ status: 'pending', changeRequestId: 'c1', policy: 'loss_edit' })).toBe(true);
    expect(isPendingApproval({ id: 'p1', name: 'Arroz' })).toBe(false);
    expect(isPendingApproval(undefined)).toBe(false);
    expect(isPendingApproval({ status: 'pending' })).toBe(false);
  });
});

describe('describeRequest', () => {
  it('update: uma linha por campo que muda (numérico comparado como número)', () => {
    const lines = describeRequest(
      request({ snapshot: { unitPrice: '10.00', name: 'Arroz' }, payload: { unitPrice: 15, name: 'Arroz' } }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Preço unitário: R\$\s?10,00 → R\$\s?15,00$/);
  });

  it('mesmo valor numérico em formatos diferentes não aparece', () => {
    expect(describeRequest(request({ snapshot: { unitPrice: '10.00' }, payload: { unitPrice: 10 } }))).toEqual([]);
  });

  it('arquivar produto e excluir perda', () => {
    expect(describeRequest(request({ operation: 'archive' }))).toEqual(['Arquivar o produto']);
    expect(describeRequest(request({ entityType: 'loss', operation: 'delete', policy: 'loss_edit' }))).toEqual([
      'Excluir a perda',
    ]);
  });

  it('referência a outro registro diz só "alterado"', () => {
    expect(
      describeRequest(
        request({ entityType: 'loss', policy: 'loss_edit', snapshot: { reasonId: 'y' }, payload: { reasonId: 'x' } }),
      ),
    ).toEqual(['Motivo: alterado']);
  });
  it('data da perda com segundos vs. o eco do formulário (minuto) não aparece como mudança', () => {
    expect(
      describeRequest(
        request({
          entityType: 'loss',
          policy: 'loss_edit',
          snapshot: { occurredAt: '2026-09-25T12:14:37.512Z', quantity: '2' },
          payload: { occurredAt: '2026-09-25T12:14:00.000Z', quantity: 3 },
        }),
      ),
    ).toEqual(['Quantidade: 2 → 3']);
  });
});

describe('describeRequest — correção retroativa (SP2, 2.3)', () => {
  it('diz quantas perdas, o período e os valores novos', () => {
    const [line] = describeRequest(
      request({
        operation: 'retro_fix',
        policy: 'retro_fix',
        payload: { from: '2026-09-01T03:00:00.000Z', to: '2026-09-21T02:59:59.999Z', unitPrice: 12, costPrice: 8 },
        snapshot: { affectedLosses: 2, currentTotal: '6.00', currentCostTotal: '4.00' },
      }),
    );
    expect(line).toMatch(/^Corrigir 2 perdas de \d{2}\/\d{2}\/2026 a \d{2}\/\d{2}\/2026: preço R\$\s?12,00, custo R\$\s?8,00$/);
  });
});

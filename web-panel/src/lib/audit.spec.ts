import { describe, expect, it } from 'vitest';
import { buildAuditQuery, describeChange, describeEntry, fieldLabel, formatAuditValue } from './audit';
import type { AuditLogEntry } from './types';

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 'a1',
    createdAt: '2026-09-24T12:00:00.000Z',
    actorUserId: null,
    actorName: null,
    actorRole: null,
    entityType: 'product',
    entityId: 'p1',
    entityLabel: 'Arroz',
    action: 'update',
    changes: [],
    summary: null,
    source: 'web',
    reason: null,
    requestId: null,
    ip: null,
    ...overrides,
  };
}

describe('rótulos da auditoria', () => {
  it('traduz campos conhecidos e deixa o nome cru para campo desconhecido', () => {
    expect(fieldLabel('unitPrice')).toBe('Preço unitário');
    expect(fieldLabel('campoNovoDoBackend')).toBe('campoNovoDoBackend');
  });
});

describe('formatAuditValue', () => {
  it('moeda aceita número e texto', () => {
    expect(formatAuditValue('unitPrice', 10.5)).toBe(formatAuditValue('unitPrice', '10.50'));
    expect(formatAuditValue('unitPrice', 10.5)).toMatch(/R\$\s?10,50/);
  });

  it('booleano vira Sim/Não; vazio vira —; papel e situação são traduzidos', () => {
    expect(formatAuditValue('isActive', false)).toBe('Não');
    expect(formatAuditValue('isActive', true)).toBe('Sim');
    expect(formatAuditValue('name', null)).toBe('—');
    expect(formatAuditValue('role', 'manager')).toBe('Gerente');
    expect(formatAuditValue('status', 'blocked')).toBe('Bloqueada');
  });
});

describe('describeChange', () => {
  it('alteração: "Rótulo: de → para"', () => {
    expect(describeChange({ field: 'unitPrice', from: 10, to: 12 }, 'update')).toMatch(
      /^Preço unitário: R\$\s?10,00 → R\$\s?12,00$/,
    );
  });

  it('criação mostra só o valor novo; exclusão só o antigo', () => {
    expect(describeChange({ field: 'name', from: null, to: 'Arroz' }, 'create')).toBe('Nome: Arroz');
    expect(describeChange({ field: 'name', from: 'Arroz', to: null }, 'delete')).toBe('Nome: Arroz');
  });

  it('senha nunca mostra valor; referências a outro registro dizem só "alterado"', () => {
    expect(describeChange({ field: 'password', from: null, to: 'alterada' }, 'update')).toBe('Senha alterada');
    expect(describeChange({ field: 'reasonId', from: 'x', to: 'y' }, 'update')).toBe('Motivo: alterado');
  });
});

describe('describeEntry', () => {
  it('evento sem alterações nem resumo (login) ⇒ lista vazia', () => {
    expect(describeEntry(entry({ entityType: 'session', action: 'login' }))).toEqual([]);
  });

  it('resumo de importação vira uma frase', () => {
    const lines = describeEntry(
      entry({
        entityType: 'import_job',
        action: 'import',
        summary: { status: 'completed', totalRows: 3, created: 1, updated: 1, reactivated: 1, errors: 0 },
      }),
    );
    expect(lines).toEqual(['3 linhas: 1 criado(s), 1 atualizado(s), 1 reativado(s), 0 com erro']);
  });

  it('importação que falhou avisa', () => {
    const [line] = describeEntry(
      entry({
        entityType: 'import_job',
        action: 'import',
        summary: { status: 'failed', totalRows: 0, created: 0, updated: 0, reactivated: 0, errors: 0 },
      }),
    );
    expect(line).toMatch(/^Falhou/);
  });

  it('alterações viram uma linha cada', () => {
    const lines = describeEntry(
      entry({ changes: [{ field: 'name', from: 'A', to: 'B' }, { field: 'isActive', from: true, to: false }] }),
    );
    expect(lines).toEqual(['Nome: A → B', 'Ativo: Sim → Não']);
  });
});

describe('buildAuditQuery', () => {
  it('sem filtros ⇒ string vazia; ignora campos vazios', () => {
    expect(buildAuditQuery({})).toBe('');
    expect(buildAuditQuery({ entityType: '', action: undefined })).toBe('');
  });

  it('"de"/"até" com só a data cobrem o dia inteiro no fuso local', () => {
    const query = new URLSearchParams(buildAuditQuery({ from: '2026-09-24', to: '2026-09-24' }).slice(1));
    expect(query.get('from')).toBe(new Date(2026, 8, 24, 0, 0, 0, 0).toISOString());
    expect(query.get('to')).toBe(new Date(2026, 8, 24, 23, 59, 59, 999).toISOString());
  });

  it('inclui entidade, ação, registro e paginação', () => {
    const query = new URLSearchParams(
      buildAuditQuery({ entityType: 'product', action: 'update', entityId: 'p1', page: 2, pageSize: 20 }).slice(1),
    );
    expect(Object.fromEntries(query)).toEqual({
      entityType: 'product',
      action: 'update',
      entityId: 'p1',
      page: '2',
      pageSize: '20',
    });
  });
});

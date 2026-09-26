import { buildImportReportCsv, WARNING_LABELS } from './report-csv';

describe('buildImportReportCsv', () => {
  const csv = buildImportReportCsv(
    ['EAN', 'Descrição'],
    [
      {
        rowNumber: 3,
        key: null,
        name: null,
        action: 'error',
        errors: ['Código de barras vazio.', 'Nome do produto vazio.'],
        warnings: [],
        raw: { EAN: '=1+1', 'Descrição': null },
      },
      {
        rowNumber: 4,
        key: '1234567',
        name: 'Arroz',
        action: 'create',
        errors: [],
        warnings: ['GTIN_LENGTH_SUSPECT', 'PRICE_ROUNDED'],
        raw: { EAN: '1234567', 'Descrição': 'Arroz' },
      },
      { rowNumber: 5, key: '1', name: 'X', action: 'duplicate', errors: [], warnings: ['DUPLICATE_IDENTICAL'], raw: null },
    ],
  );
  const lines = csv.split('\r\n');

  it('BOM, CRLF e cabeçalho com as colunas originais no fim', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('﻿Linha;Código de barras;Nome;Situação;Erros;Avisos;EAN;Descrição');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('erro, com célula original protegida contra fórmula', () => {
    expect(lines[1]).toBe("3;;;Erro;Código de barras vazio. | Nome do produto vazio.;;'=1+1;");
  });

  it('avisos traduzidos', () => {
    expect(lines[2]).toBe(
      `4;1234567;Arroz;Aviso;;${WARNING_LABELS.GTIN_LENGTH_SUSPECT} | ${WARNING_LABELS.PRICE_ROUNDED};1234567;Arroz`,
    );
    expect(lines[3]).toBe('5;1;X;Repetida;;Linha repetida (ignorada);;');
  });

  it('todos os códigos de aviso têm rótulo', () => {
    expect(Object.keys(WARNING_LABELS).sort()).toEqual(
      [
        'AMBIGUOUS_DECIMAL',
        'COST_ABOVE_PRICE',
        'DUPLICATE_IDENTICAL',
        'GTIN_CHECK_DIGIT',
        'GTIN_LENGTH_SUSPECT',
        'NAME_TRUNCATED',
        'PRICE_JUMP',
        'PRICE_ROUNDED',
      ].sort(),
    );
  });
});

import {
  cellToText,
  gtinCheckDigitValid,
  normalizeBarcode,
  normalizeName,
  normalizeSku,
  parseMoney,
} from './normalize';

describe('cellToText — célula do xlsx vira texto (F9e)', () => {
  it.each<[string, unknown, string | null]>([
    ['null', null, null],
    ['undefined', undefined, null],
    ['texto vazio', '', null],
    ['texto é devolvido como veio (quem apara é o campo)', '  abc ', '  abc '],
    ['EAN numérico sem notação científica', 7891234567895, '7891234567895'],
    ['inteiro maior que o seguro', 1e21, '1000000000000000000000'],
    ['número com fração', 12.5, '12.5'],
    ['fórmula ⇒ resultado', { formula: 'A1*2', result: 20 }, '20'],
    ['texto rico ⇒ concatenação', { richText: [{ text: 'Arroz ' }, { text: 'Tipo 1' }] }, 'Arroz Tipo 1'],
    ['hiperlink ⇒ texto', { text: 'site', hyperlink: 'http://x' }, 'site'],
    ['data ⇒ ISO', new Date(Date.UTC(2026, 8, 1)), '2026-09-01'],
    ['booleano', true, 'true'],
  ])('%s', (_name, value, expected) => {
    expect(cellToText(value as never)).toEqual({ text: expected });
  });

  it('fórmula com resultado de erro ⇒ erro', () => {
    expect(cellToText({ formula: 'X', result: { error: '#N/A' } } as never)).toEqual({
      text: null,
      error: 'Célula com erro (#N/A).',
    });
  });

  it('célula de erro ⇒ erro', () => {
    expect(cellToText({ error: '#DIV/0!' } as never)).toEqual({ text: null, error: 'Célula com erro (#DIV/0!).' });
  });
});

describe('normalizeBarcode', () => {
  it('remove separadores de código só com dígitos', () => {
    expect(normalizeBarcode(' 789.1234-567 895 ')).toEqual({ value: '7891234567895', errors: [], warnings: [] });
  });
  it('código com letras fica como está (código interno de ERP)', () => {
    expect(normalizeBarcode('ABC-123')).toEqual({ value: 'ABC-123', errors: [], warnings: [] });
  });
  it.each([[''], [null], ['   ']])('vazio (%p) ⇒ erro', (text) => {
    expect(normalizeBarcode(text).errors).toEqual(['Código de barras vazio.']);
  });
  it('mais de 64 caracteres ⇒ erro', () => {
    expect(normalizeBarcode('A'.repeat(65)).errors).toEqual(['Código de barras com mais de 64 caracteres.']);
  });
  it.each(['1234567', '12345678901'])('tamanho %s suspeito ⇒ aviso', (code) => {
    expect(normalizeBarcode(code).warnings).toEqual(['GTIN_LENGTH_SUSPECT']);
  });
  it.each(['7891234567895', '036000291452', '96385074', '12345'])('%s sem aviso', (code) => {
    expect(normalizeBarcode(code)).toEqual({ value: code, errors: [], warnings: [] });
  });
  it.each(['7,89123E+12', '7.89123e+12', '7,89E12'])('notação científica do Excel (%s) ⇒ erro', (code) => {
    expect(normalizeBarcode(code)).toEqual({
      value: null,
      errors: ['Código em notação científica: o Excel cortou os dígitos. Formate a coluna como Texto e exporte de novo.'],
      warnings: [],
    });
  });
  it('dígito verificador inválido ⇒ aviso', () => {
    expect(normalizeBarcode('7891234567890').warnings).toEqual(['GTIN_CHECK_DIGIT']);
  });
});

describe('parseMoney — preço/custo em formatos brasileiros (F9f)', () => {
  it.each<[string, number, string[]]>([
    ['12,50', 12.5, []],
    ['1.234,56', 1234.56, []],
    ['R$ 12,50', 12.5, []],
    ['R$ 1.234,56', 1234.56, []],
    ['12.5', 12.5, []],
    ['1,234.56', 1234.56, []],
    ['1.234', 1.23, ['AMBIGUOUS_DECIMAL', 'PRICE_ROUNDED']],
    ['1.234.567', 1234567, []],
    ['1,5', 1.5, []],
    ['1,234,567', 1234567, []],
    ['12,345', 12.35, ['PRICE_ROUNDED']],
    ['0,005', 0.01, ['PRICE_ROUNDED']],
    ['10', 10, []],
  ])('%s ⇒ %d', (text, value, warnings) => {
    expect(parseMoney(text)).toEqual({ value, errors: [], warnings });
  });

  it.each([[''], [null], ['  ']])('vazio (%p) ⇒ não informado', (text) => {
    expect(parseMoney(text)).toEqual({ value: null, errors: [], warnings: [] });
  });
  it('não numérico ⇒ erro', () => {
    expect(parseMoney('abc').errors).toEqual(['Preço inválido: "abc".']);
  });
  it('negativo ⇒ erro', () => {
    expect(parseMoney('-5').errors).toEqual(['Preço negativo: "-5".']);
  });
  it('acima do limite ⇒ erro', () => {
    expect(parseMoney('10000000000').errors).toEqual(['Preço acima do limite: "10000000000".']);
  });
});

describe('normalizeName', () => {
  it('apara e junta espaços', () => {
    expect(normalizeName('  Arroz   Tipo 1 ')).toEqual({ value: 'Arroz Tipo 1', errors: [], warnings: [] });
  });
  it('vazio ⇒ erro', () => {
    expect(normalizeName(' ').errors).toEqual(['Nome do produto vazio.']);
  });
  it('mais de 200 ⇒ corta com aviso', () => {
    const result = normalizeName('a'.repeat(201));
    expect(result.value).toHaveLength(200);
    expect(result.warnings).toEqual(['NAME_TRUNCATED']);
  });
});

describe('normalizeSku', () => {
  it('apara', () => expect(normalizeSku(' A1 ')).toEqual({ value: 'A1', errors: [], warnings: [] }));
  it('vazio ⇒ null', () => expect(normalizeSku('')).toEqual({ value: null, errors: [], warnings: [] }));
  it('mais de 60 ⇒ erro', () => expect(normalizeSku('S'.repeat(61)).errors).toEqual(['SKU com mais de 60 caracteres.']));
});

describe('gtinCheckDigitValid', () => {
  it.each<[string, boolean]>([
    ['7891234567895', true],
    ['96385074', true],
    ['7891234567890', false],
  ])('%s ⇒ %p', (code, valid) => expect(gtinCheckDigitValid(code)).toBe(valid));
});

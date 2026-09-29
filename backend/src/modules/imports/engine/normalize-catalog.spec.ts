import { normalizeCategoryPath, normalizeUnit, parseBooleanPt, parseMoney, parseShelfLifeDays } from './normalize';

describe('normalizeCategoryPath (SP4 4.1)', () => {
  it.each<[string, string | null, string[] | null]>([
    ['vazio', null, null],
    ['um nível', ' Mercearia ', ['Mercearia']],
    ['separador >', 'Mercearia > Bebidas', ['Mercearia', 'Bebidas']],
    ['vários níveis', 'Mercearia > Bebidas > Refrigerantes', ['Mercearia', 'Bebidas', 'Refrigerantes']],
    ['"/" faz parte do nome (é o que a exportação grava)', 'Frios/Laticínios > Queijos', ['Frios/Laticínios', 'Queijos']],
    ['espaços internos repetidos e partes vazias', 'Mercearia >>  Bebidas  Quentes', ['Mercearia', 'Bebidas Quentes']],
  ])('%s', (_name, text, expected) => {
    const result = normalizeCategoryPath(text);
    expect(result.errors).toEqual([]);
    expect(result.value).toEqual(expected);
  });

  it('mais de 3 níveis é erro', () => {
    expect(normalizeCategoryPath('A > B > C > D').errors).toEqual(['Categoria com mais de 3 níveis.']);
  });

  it('nível com mais de 80 caracteres é erro', () => {
    expect(normalizeCategoryPath('x'.repeat(81)).errors).toEqual(['Categoria com mais de 80 caracteres.']);
  });
});

describe('normalizeUnit (SP4 4.1)', () => {
  it.each<[string | null, string | null]>([
    [null, null],
    ['UN', 'UN'],
    ['unid', 'UN'],
    ['Kilo', 'KG'],
    ['quilo', 'KG'],
    ['kg', 'KG'],
    ['Lt', 'L'],
    ['litro', 'L'],
    ['ml', 'ML'],
    ['grama', 'G'],
    ['caixa', 'CX'],
    ['pacote', 'PCT'],
    ['dúzia', 'DZ'],
    ['metro', 'M'],
  ])('%s → %s', (text, expected) => {
    const result = normalizeUnit(text);
    expect(result.errors).toEqual([]);
    expect(result.value).toBe(expected);
  });

  it('unidade desconhecida é erro', () => {
    expect(normalizeUnit('xx').errors).toEqual(['Unidade desconhecida: "xx".']);
  });
});

describe('parseBooleanPt (SP4 4.1)', () => {
  it.each<[string | null, boolean | null]>([
    [null, null],
    ['', null],
    ['Sim', true],
    ['s', true],
    ['X', true],
    ['1', true],
    ['true', true],
    ['Não', false],
    ['nao', false],
    ['N', false],
    ['0', false],
    ['false', false],
  ])('%s → %s', (text, expected) => {
    const result = parseBooleanPt(text);
    expect(result.errors).toEqual([]);
    expect(result.value).toBe(expected);
  });

  it('texto que não é sim/não é erro', () => {
    expect(parseBooleanPt('talvez').errors).toEqual(['Valor inválido para Sim/Não: "talvez".']);
  });
});

describe('parseShelfLifeDays (SP4 4.1)', () => {
  it.each<[string | null, number | null]>([
    [null, null],
    ['', null],
    ['180', 180],
    [' 3 ', 3],
    ['30 dias', 30],
  ])('%s → %s', (text, expected) => {
    const result = parseShelfLifeDays(text);
    expect(result.errors).toEqual([]);
    expect(result.value).toBe(expected);
  });

  it('coluna com data (validade do lote) tem mensagem própria', () => {
    expect(parseShelfLifeDays('31/12/2026').errors).toEqual([
      'A coluna de validade parece ter datas ("31/12/2026"); aqui vai a validade em dias.',
    ]);
  });

  it.each(['0', '-5', '2,5', 'abc'])('"%s" é erro', (text) => {
    expect(parseShelfLifeDays(text).errors).toEqual([`Validade inválida: "${text}". Use o número de dias.`]);
  });
});

describe('parseMoney com 4 casas (custo, SP4 4.1)', () => {
  it('mantém 4 casas sem aviso de arredondamento', () => {
    expect(parseMoney('3,1234', { decimals: 4 })).toEqual({ value: 3.1234, errors: [], warnings: [] });
  });

  it('arredonda a 5ª casa pelo texto', () => {
    expect(parseMoney('0,00005', { decimals: 4 })).toEqual({ value: 0.0001, errors: [], warnings: ['PRICE_ROUNDED'] });
  });

  it('sem opção continua com 2 casas', () => {
    expect(parseMoney('3,1234').value).toBe(3.12);
  });
});

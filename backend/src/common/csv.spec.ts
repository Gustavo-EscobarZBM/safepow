import { csvCell, csvLine } from './csv';

describe('csv', () => {
  it('protege células que o Excel leria como fórmula', () => {
    expect(csvCell('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(csvCell('-1')).toBe("'-1");
  });
  it('põe entre aspas o que tem ; aspas ou quebra de linha', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });
  it('vazio para null/undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('csvLine junta com ;', () => {
    expect(csvLine(['a', 1])).toBe('a;1');
  });
});

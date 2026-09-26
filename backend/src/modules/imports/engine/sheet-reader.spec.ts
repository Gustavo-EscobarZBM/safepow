import { ImportFileError } from './file-sniff';
import { listSheets, openTable, peekTable, TableRow } from './sheet-reader';
import { csvBuffer, xlsxBuffer } from './test-fixtures';

async function collect(rows: AsyncIterable<TableRow>): Promise<TableRow[]> {
  const out: TableRow[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

describe('openTable — xlsx', () => {
  it('lê a aba pedida pelo nome, pulando linhas vazias com o número da linha real', async () => {
    const buffer = await xlsxBuffer({
      Capa: [['nada']],
      Produtos: [['Código', 'Nome'], ['1', 'Arroz'], [], ['2', 'Feijão'], []],
    });
    const { headers, rows } = await openTable(buffer, { format: 'xlsx', sheetName: 'Produtos' });
    expect(headers).toEqual(['Código', 'Nome']);
    const all = await collect(rows);
    expect(all.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(all[1].cells).toEqual(['2', 'Feijão']);
  });

  it('sem aba ⇒ primeira; número grande vira texto exato; fórmula vira resultado; erro vira cellErrors', async () => {
    const buffer = await xlsxBuffer({
      A: [
        ['EAN', 'Preço', 'Obs'],
        [7891234567895, { formula: '2*5', result: 10 }, { error: '#N/A' }],
      ],
    });
    const { rows } = await openTable(buffer, { format: 'xlsx' });
    const [row] = await collect(rows);
    expect(row.cells).toEqual(['7891234567895', '10', null]);
    expect(row.cellErrors).toEqual([undefined, undefined, 'Célula com erro (#N/A).']);
  });

  it('cabeçalho depois de linhas vazias', async () => {
    const buffer = await xlsxBuffer({ A: [[], [], ['Código', 'Nome'], ['1', 'Arroz']] });
    const { headers, rows } = await openTable(buffer, { format: 'xlsx' });
    expect(headers).toEqual(['Código', 'Nome']);
    expect((await collect(rows)).map((r) => r.rowNumber)).toEqual([4]);
  });

  it('aba inexistente ⇒ UNSUPPORTED_FILE', async () => {
    const buffer = await xlsxBuffer({ A: [['x']] });
    await expect(openTable(buffer, { format: 'xlsx', sheetName: 'Nope' })).rejects.toMatchObject({
      errorCode: 'UNSUPPORTED_FILE',
      message: 'A aba "Nope" não existe na planilha.',
    });
    await expect(openTable(buffer, { format: 'xlsx', sheetName: 'Nope' })).rejects.toBeInstanceOf(ImportFileError);
  });
});

describe('openTable — csv', () => {
  it('Windows-1252 com ; e campo entre aspas', async () => {
    const buffer = csvBuffer(
      [
        ['Código', 'Descrição', 'Preço'],
        ['1', 'Arroz; tipo 1', '1.234,56'],
      ],
      { delimiter: ';', encoding: 'windows-1252' },
    );
    const { headers, rows } = await openTable(buffer, { format: 'csv' });
    expect(headers).toEqual(['Código', 'Descrição', 'Preço']);
    expect(await collect(rows)).toEqual([{ rowNumber: 2, cells: ['1', 'Arroz; tipo 1', '1.234,56'], cellErrors: [] }]);
  });

  it('UTF-8 com BOM e vírgula; linha curta completada com null; linha vazia pulada', async () => {
    const buffer = csvBuffer([['a', 'b', 'c'], ['1'], [''], ['2', '3', '4']], { delimiter: ',', encoding: 'utf-8', bom: true });
    const { headers, rows } = await openTable(buffer, { format: 'csv' });
    expect(headers).toEqual(['a', 'b', 'c']);
    const all = await collect(rows);
    expect(all.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(all[0].cells).toEqual(['1', null, null]);
  });
});

describe('peekTable e listSheets', () => {
  it('amostra de 20 linhas', async () => {
    const data = Array.from({ length: 100 }, (_, i) => [String(i), `P${i}`]);
    const buffer = await xlsxBuffer({ A: [['Código', 'Nome'], ...data] });
    const { headers, sample } = await peekTable(buffer, { format: 'xlsx' });
    expect(headers).toEqual(['Código', 'Nome']);
    expect(sample).toHaveLength(20);
    expect(sample[0]).toEqual(['0', 'P0']);
  });

  it('abas na ordem da pasta de trabalho; csv ⇒ []', async () => {
    expect(await listSheets(await xlsxBuffer({ Zeta: [['x']], 'Alfa & Cia': [['y']] }))).toEqual(['Zeta', 'Alfa & Cia']);
    expect(await listSheets(csvBuffer([['a']], { delimiter: ';', encoding: 'utf-8' }))).toEqual([]);
  });
});

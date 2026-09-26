import { assertSafeZip, decodeCsv, detectDelimiter, detectFormat, ImportFileError, readZipEntry } from './file-sniff';
import { csvBuffer, rawZip, xlsxBuffer, zipWithDeclaredSize } from './test-fixtures';

function errorOf(fn: () => unknown): ImportFileError {
  try {
    fn();
  } catch (error) {
    return error as ImportFileError;
  }
  throw new Error('não lançou');
}

describe('detectFormat', () => {
  it('xlsx pelo conteúdo', async () => {
    expect(detectFormat(await xlsxBuffer({ A: [['x']] }))).toBe('xlsx');
  });
  it('csv pelo conteúdo', () => {
    expect(detectFormat(csvBuffer([['a', 'b']], { delimiter: ';', encoding: 'utf-8' }))).toBe('csv');
  });
  it('binário que não é zip ⇒ UNSUPPORTED_FILE', () => {
    const error = errorOf(() => detectFormat(Buffer.from([0x47, 0x49, 0x46, 0x00, 0x01])));
    expect(error).toBeInstanceOf(ImportFileError);
    expect(error).toMatchObject({ errorCode: 'UNSUPPORTED_FILE', message: 'Formato não suportado. Envie .xlsx ou .csv.' });
  });
  it('vazio ⇒ EMPTY_FILE', () => {
    expect(errorOf(() => detectFormat(Buffer.alloc(0)))).toMatchObject({
      errorCode: 'EMPTY_FILE',
      message: 'O arquivo está vazio.',
    });
  });
});

describe('assertSafeZip — proteção contra zip bomb', () => {
  it('descompactado acima de 200 MB ⇒ FILE_TOO_LARGE_UNCOMPRESSED', () => {
    expect(errorOf(() => assertSafeZip(zipWithDeclaredSize(300 * 1024 * 1024)))).toMatchObject({
      errorCode: 'FILE_TOO_LARGE_UNCOMPRESSED',
      message: 'A planilha descompactada passa de 200 MB.',
    });
  });
  it('xlsx normal passa', async () => {
    expect(() => assertSafeZip(Buffer.from([]))).toThrow();
    const buffer = await xlsxBuffer({ A: [['x', 1]] });
    expect(() => assertSafeZip(buffer)).not.toThrow();
  });
  it('zip truncado ⇒ UNSUPPORTED_FILE', async () => {
    const buffer = await xlsxBuffer({ A: [['x']] });
    expect(errorOf(() => assertSafeZip(buffer.subarray(0, buffer.length - 30)))).toMatchObject({
      errorCode: 'UNSUPPORTED_FILE',
    });
  });
});

describe('decodeCsv', () => {
  it('Windows-1252 com acentos', () => {
    const result = decodeCsv(csvBuffer([['Descrição', 'Preço']], { delimiter: ';', encoding: 'windows-1252' }));
    expect(result.encoding).toBe('windows-1252');
    expect(result.text.startsWith('Descrição;Preço')).toBe(true);
  });
  it('UTF-8 com BOM (BOM removido)', () => {
    const result = decodeCsv(csvBuffer([['Descrição']], { delimiter: ';', encoding: 'utf-8', bom: true }));
    expect(result.encoding).toBe('utf-8');
    expect(result.text.startsWith('Descrição')).toBe(true);
  });
});

describe('detectDelimiter', () => {
  it.each<[string, string]>([
    ['a;b;"c,d"', ';'],
    ['a,b,c', ','],
    ['a\tb', '\t'],
    ['abc', ';'],
  ])('%p ⇒ %p', (line, delimiter) => expect(detectDelimiter(line)).toBe(delimiter));
});

describe('readZipEntry — não confia no tamanho declarado', () => {
  it('conteúdo que descompacta além do declarado ⇒ UNSUPPORTED_FILE', () => {
    const buffer = rawZip([{ name: 'xl/workbook.xml', data: Buffer.alloc(5_000_000), deflate: true, declared: 100 }]);
    expect(errorOf(() => readZipEntry(buffer, 'xl/workbook.xml'))).toMatchObject({ errorCode: 'UNSUPPORTED_FILE' });
  });
  it('conteúdo honesto é lido', () => {
    const buffer = rawZip([{ name: 'a.xml', data: '<x/>', deflate: true }]);
    expect(readZipEntry(buffer, 'a.xml')?.toString()).toBe('<x/>');
  });
});

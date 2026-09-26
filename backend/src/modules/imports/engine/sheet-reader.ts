import { parse } from 'csv-parse';
import { SaxesParser, SaxesTagPlain } from 'saxes';
import { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import { decodeCsv, detectDelimiter, ImportFileError, readZipEntry, zipEntryStream } from './file-sniff';
import { cellToText } from './normalize';

/**
 * Leitura de planilhas em streaming (SP3, spec 2.1/2.3): o cabeçalho é a primeira linha não vazia; as linhas
 * seguintes saem uma a uma, puladas as totalmente vazias, com o número da linha no arquivo (1-based).
 *
 * O .xlsx é lido aqui mesmo (zip do file-sniff + zlib em streaming + SAX), e não pelo WorkbookReader do exceljs:
 * no 4.4 ele quebra de forma intermitente quando xl/workbook.xml vem depois das abas no zip (o caso dos arquivos
 * gerados pelo próprio exceljs) e grava abas em arquivos temporários. Só os valores importam para a importação:
 * data chega como o número de série do Excel (nenhum campo importado é data).
 */

export interface TableSource {
  format: 'xlsx' | 'csv';
  sheetName?: string | null;
  delimiter?: string | null;
}

export interface TableRow {
  rowNumber: number;
  cells: (string | null)[];
  cellErrors: (string | undefined)[];
}

const isBlank = (cells: (string | null)[], errors: (string | undefined)[]) =>
  cells.every((c) => c === null || c.trim() === '') && errors.every((e) => !e);

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]) : null;
}

interface SheetInfo {
  name: string;
  path: string | null;
}

/** Abas na ordem da pasta de trabalho, com o caminho do XML de cada uma dentro do zip. */
function workbookSheets(buffer: Buffer): SheetInfo[] {
  const workbookXml = readZipEntry(buffer, 'xl/workbook.xml')?.toString('utf8') ?? '';
  const relsXml = readZipEntry(buffer, 'xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const targets = new Map(
    [...relsXml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((m) => [
      attribute(m[0], 'Id'),
      // Relativo a xl/ ("worksheets/sheet1.xml") ou absoluto ("/xl/worksheets/sheet1.xml").
      (attribute(m[0], 'Target') ?? '').replace(/^\/?(xl\/)?/, 'xl/'),
    ]),
  );
  return [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => ({
    name: attribute(m[0], 'name') ?? '',
    path: targets.get(attribute(m[0], 'r:id')) ?? null,
  }));
}

const isZip = (buffer: Buffer) => buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;

export async function listSheets(buffer: Buffer): Promise<string[]> {
  return isZip(buffer) ? workbookSheets(buffer).map((s) => s.name) : [];
}

function sharedStrings(buffer: Buffer): string[] {
  const xml = readZipEntry(buffer, 'xl/sharedStrings.xml');
  if (!xml) return [];
  const strings: string[] = [];
  const parser = new SaxesParser();
  let current: string | null = null;
  let inText = false;
  let phonetic = 0;
  parser.on('opentag', (tag) => {
    const name = localName(tag.name);
    if (name === 'si') current = '';
    else if (name === 'rPh') phonetic++;
    else if (name === 't' && phonetic === 0) inText = true;
  });
  parser.on('text', (text) => {
    if (inText && current !== null) current += text;
  });
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (name === 't') inText = false;
    else if (name === 'rPh') phonetic--;
    else if (name === 'si') {
      strings.push(current ?? '');
      current = null;
    }
  });
  parser.write(xml.toString('utf8')).close();
  return strings;
}

/** Última coluna do Excel (XFD): uma referência forjada além dela não pode fazer o leitor alocar milhões de colunas. */
const MAX_COLUMNS = 16_384;

function columnIndex(ref: string | undefined, fallback: number): number {
  const letters = ref?.match(/^[A-Z]{1,4}/)?.[0];
  if (!letters) return fallback;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Valor da célula no XML ⇒ texto (ou erro), conforme o tipo `t`. */
function xlsxCellText(type: string | undefined, value: string, inline: string, strings: string[]): { text: string | null; error?: string } {
  switch (type) {
    case 's':
      return { text: strings[Number(value)] ?? null };
    case 'inlineStr':
      return { text: inline || null };
    case 'str':
      return { text: value || null };
    case 'b':
      return { text: value === '1' ? 'true' : 'false' };
    case 'e':
      return { text: null, error: `Célula com erro (${value}).` };
    default:
      if (value === '') return { text: null };
      // Inteiro gravado por extenso fica como está (EAN com 13 dígitos exatos); "1.23E+12" passa por Number.
      return /^\d+$/.test(value) ? { text: value } : cellToText(Number(value));
  }
}

async function* xlsxRows(buffer: Buffer, sheetName: string | null | undefined): AsyncGenerator<TableRow> {
  const sheets = workbookSheets(buffer);
  const sheet = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  const stream = sheet?.path ? zipEntryStream(buffer, sheet.path) : null;
  if (!stream) return;
  const strings = sharedStrings(buffer);

  const parser = new SaxesParser();
  const ready: TableRow[] = [];
  let rowNumber = 0;
  let cells: (string | null)[] = [];
  let cellErrors: (string | undefined)[] = [];
  let cell: { index: number; type?: string; value: string; inline: string } | null = null;
  let capture: 'v' | 't' | null = null;
  let inInline = false;

  parser.on('opentag', (tag: SaxesTagPlain) => {
    const name = localName(tag.name);
    if (name === 'row') {
      rowNumber = Number(tag.attributes.r) || rowNumber + 1;
      cells = [];
      cellErrors = [];
    } else if (name === 'c') {
      cell = { index: columnIndex(tag.attributes.r, cells.length), type: tag.attributes.t, value: '', inline: '' };
    } else if (name === 'is') {
      inInline = true;
    } else if (cell && name === 'v') {
      capture = 'v';
    } else if (cell && inInline && name === 't') {
      capture = 't';
    }
  });
  parser.on('text', (text) => {
    if (!cell) return;
    if (capture === 'v') cell.value += text;
    else if (capture === 't') cell.inline += text;
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    const name = localName(tag.name);
    if (name === 'v' || name === 't') capture = null;
    else if (name === 'is') inInline = false;
    else if (name === 'c' && cell && cell.index >= MAX_COLUMNS) {
      cell = null;
    } else if (name === 'c' && cell) {
      const { text, error } = xlsxCellText(cell.type, cell.value, cell.inline, strings);
      while (cells.length < cell.index) {
        cells.push(null);
        cellErrors.push(undefined);
      }
      cells[cell.index] = text;
      cellErrors[cell.index] = error;
      cell = null;
    } else if (name === 'row') {
      ready.push({ rowNumber, cells, cellErrors });
    }
  });

  const decoder = new StringDecoder('utf8');
  for await (const chunk of stream) {
    parser.write(decoder.write(chunk as Buffer));
    yield* ready.splice(0);
  }
  parser.write(decoder.end()).close();
  yield* ready.splice(0);
}

async function* csvRows(buffer: Buffer, delimiter: string | null | undefined): AsyncGenerator<TableRow> {
  const { text } = decodeCsv(buffer);
  const parser = Readable.from([text]).pipe(
    parse({
      delimiter: delimiter || detectDelimiter(text.split(/\r?\n/, 1)[0] ?? ''),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      info: true,
    }),
  );
  for await (const { record, info } of parser as AsyncIterable<{ record: string[]; info: { lines: number } }>) {
    yield { rowNumber: info.lines, cells: record.map((c) => (c === '' ? null : c)), cellErrors: [] };
  }
}

export async function openTable(
  buffer: Buffer,
  source: TableSource,
): Promise<{ headers: string[]; rows: AsyncIterable<TableRow> }> {
  if (source.format === 'xlsx' && source.sheetName && !(await listSheets(buffer)).includes(source.sheetName)) {
    throw new ImportFileError('UNSUPPORTED_FILE', `A aba "${source.sheetName}" não existe na planilha.`);
  }
  const iterator = (source.format === 'xlsx' ? xlsxRows(buffer, source.sheetName) : csvRows(buffer, source.delimiter))[
    Symbol.asyncIterator
  ]();

  let headers: string[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    if (isBlank(next.value.cells, next.value.cellErrors)) continue;
    headers = next.value.cells.map((c) => (c ?? '').trim());
    while (headers.length && !headers[headers.length - 1]) headers.pop();
    break;
  }
  const width = headers.length;

  async function* rows(): AsyncGenerator<TableRow> {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      const { rowNumber, cells, cellErrors } = next.value;
      if (isBlank(cells, cellErrors)) continue;
      const padded = Array.from({ length: Math.max(width, cells.length) }, (_, i) => cells[i] ?? null);
      yield { rowNumber, cells: padded, cellErrors };
    }
  }

  return { headers, rows: rows() };
}

export async function peekTable(
  buffer: Buffer,
  source: TableSource,
  sampleSize = 20,
): Promise<{ headers: string[]; sample: (string | null)[][] }> {
  const { headers, rows } = await openTable(buffer, source);
  const sample: (string | null)[][] = [];
  for await (const row of rows) {
    sample.push(row.cells);
    if (sample.length >= sampleSize) break;
  }
  return { headers, sample };
}

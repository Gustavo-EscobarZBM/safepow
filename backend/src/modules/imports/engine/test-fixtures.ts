import * as ExcelJS from 'exceljs';
import * as iconv from 'iconv-lite';
import { deflateRawSync } from 'zlib';

/** Geradores de planilha para os testes do motor de importação (SP3). Só usado por testes. */

export async function xlsxBuffer(
  sheets: Record<string, unknown[][]>,
  opts: { textColumns?: number[] } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    for (const col of opts.textColumns ?? []) sheet.getColumn(col).numFmt = '@';
    for (const row of rows) sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function csvBuffer(
  lines: string[][],
  opts: { delimiter: string; encoding: 'utf-8' | 'windows-1252'; bom?: boolean },
): Buffer {
  const quote = (cell: string) =>
    cell.includes(opts.delimiter) || cell.includes('"') || /[\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  const text = lines.map((line) => line.map(quote).join(opts.delimiter)).join('\r\n') + '\r\n';
  const body = opts.encoding === 'utf-8' ? Buffer.from(text, 'utf-8') : iconv.encode(text, 'win1252');
  return opts.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

/**
 * Zip montado à mão: cada arquivo com o conteúdo dado, comprimido (deflate) ou não, e o tamanho descompactado
 * DECLARADO podendo mentir (`declared`) — para testar xlsx forjados.
 */
export function rawZip(files: { name: string; data: Buffer | string; deflate?: boolean; declared?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const plain = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const body = file.deflate ? deflateRawSync(plain) : plain;
    const declared = file.declared ?? plain.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

/** .xlsx mínimo com uma aba "A" cujo XML de <sheetData> é dado. */
export function rawXlsx(sheetData: string, opts: { deflate?: boolean; declared?: number } = {}): Buffer {
  return rawZip([
    {
      name: 'xl/workbook.xml',
      data: '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData>${sheetData}</sheetData></worksheet>`, ...opts },
  ]);
}

/** Zip mínimo (um arquivo vazio) cujo diretório central DECLARA `uncompressed` bytes — imita um zip bomb. */
export function zipWithDeclaredSize(uncompressed: number): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(0, 18);
  local.writeUInt32LE(uncompressed, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(0, 20);
  central.writeUInt32LE(uncompressed, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length;
  const centralSize = central.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, central, name, eocd]);
}

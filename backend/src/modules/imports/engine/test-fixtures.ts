import * as ExcelJS from 'exceljs';
import * as iconv from 'iconv-lite';

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

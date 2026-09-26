import * as iconv from 'iconv-lite';
import { Readable, Transform } from 'stream';
import { createInflateRaw, inflateRawSync } from 'zlib';

/** Reconhecimento do arquivo enviado (SP3, spec 2.1): formato pelo conteúdo, zip bomb, codificação, delimitador. */

export type ImportFileErrorCode = 'UNSUPPORTED_FILE' | 'FILE_TOO_LARGE_UNCOMPRESSED' | 'EMPTY_FILE' | 'TOO_MANY_ROWS';

export class ImportFileError extends Error {
  constructor(
    public readonly errorCode: ImportFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportFileError';
  }
}

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const EOCD_MAX_SCAN = 22 + 0xffff;
const DEFAULT_MAX_UNCOMPRESSED = 200 * 1024 * 1024;

export function detectFormat(buffer: Buffer): 'xlsx' | 'csv' {
  if (buffer.length === 0) throw new ImportFileError('EMPTY_FILE', 'O arquivo está vazio.');
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_SIGNATURE) return 'xlsx';
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new ImportFileError('UNSUPPORTED_FILE', 'Formato não suportado. Envie .xlsx ou .csv.');
  }
  return 'csv';
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const corruptZip = () => new ImportFileError('UNSUPPORTED_FILE', 'A planilha está corrompida ou não é um .xlsx válido.');

/** Lê o diretório central do zip (sem descompactar nada). */
function zipEntries(buffer: Buffer): ZipEntry[] {
  const start = Math.max(0, buffer.length - EOCD_MAX_SCAN);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw corruptZip();
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) throw corruptZip();
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Acima deste tamanho descompactado, uma entrada comprimida mais de 100x é tratada como zip bomb. */
const RATIO_CHECK_MIN_BYTES = 10 * 1024 * 1024;
const MAX_RATIO = 100;

/**
 * Recusa o .xlsx cujo conteúdo descompactado passe do limite, lendo só os tamanhos declarados no diretório
 * central (a leitura corta no tamanho declarado — ver readZipEntry/zipEntryStream). A razão de compressão só é
 * checada em entradas grandes: abas pequenas e repetitivas passam de 100x legitimamente, mas 10 MB+ comprimidos
 * mais de 100x é zip bomb (XML de planilha real comprime ~10–20x).
 */
export function assertSafeZip(buffer: Buffer, limits: { maxUncompressedBytes: number } = { maxUncompressedBytes: DEFAULT_MAX_UNCOMPRESSED }): void {
  const entries = zipEntries(buffer);
  const total = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (total > limits.maxUncompressedBytes) {
    throw new ImportFileError(
      'FILE_TOO_LARGE_UNCOMPRESSED',
      `A planilha descompactada passa de ${Math.round(limits.maxUncompressedBytes / 1024 / 1024)} MB.`,
    );
  }
  for (const entry of entries) {
    if (entry.uncompressedSize > RATIO_CHECK_MIN_BYTES && entry.uncompressedSize > MAX_RATIO * Math.max(entry.compressedSize, 1)) {
      throw new ImportFileError('FILE_TOO_LARGE_UNCOMPRESSED', 'A planilha tem conteúdo comprimido de forma suspeita e não pode ser lida.');
    }
  }
}

function entryData(buffer: Buffer, name: string): { entry: ZipEntry; data: Buffer } | null {
  const entry = zipEntries(buffer).find((e) => e.name === name);
  if (!entry) return null;
  const local = entry.localHeaderOffset;
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== ZIP_LOCAL_SIGNATURE) throw corruptZip();
  const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
  if (entry.method !== 0 && entry.method !== 8) throw corruptZip();
  return { entry, data: buffer.subarray(dataStart, dataStart + entry.compressedSize) };
}

const MAX_SMALL_ENTRY_BYTES = 5 * 1024 * 1024;

/** Tamanho descompactado declarado de um arquivo do zip (null se não existe). */
export function zipEntrySize(buffer: Buffer, name: string): number | null {
  return zipEntries(buffer).find((e) => e.name === name)?.uncompressedSize ?? null;
}

/**
 * Conteúdo de um arquivo PEQUENO do zip (workbook.xml, rels), descompactado de uma vez. Nunca descompacta além
 * do tamanho declarado (um zip forjado que declara pouco e expande muito é recusado) nem além de 5 MB.
 */
export function readZipEntry(buffer: Buffer, name: string): Buffer | null {
  const found = entryData(buffer, name);
  if (!found) return null;
  const declared = found.entry.uncompressedSize;
  if (declared > MAX_SMALL_ENTRY_BYTES) {
    throw new ImportFileError('FILE_TOO_LARGE_UNCOMPRESSED', 'A planilha tem um arquivo interno grande demais.');
  }
  if (found.entry.method === 0) {
    if (found.data.length > declared) throw corruptZip();
    return found.data;
  }
  try {
    return inflateRawSync(found.data, { maxOutputLength: Math.max(declared, 1) });
  } catch {
    throw corruptZip();
  }
}

/** Conteúdo de um arquivo do zip como stream descompactado (as abas), cortado no tamanho declarado. */
export function zipEntryStream(buffer: Buffer, name: string): Readable | null {
  const found = entryData(buffer, name);
  if (!found) return null;
  const declared = found.entry.uncompressedSize;
  let total = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      callback(total > declared ? corruptZip() : null, total > declared ? undefined : chunk);
    },
  });
  const source = Readable.from([found.data]);
  const inflated = found.entry.method === 0 ? source : source.pipe(createInflateRaw());
  inflated.on('error', () => limiter.destroy(corruptZip()));
  return inflated.pipe(limiter);
}

export function decodeCsv(buffer: Buffer): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  const body = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    // Excel brasileiro "CSV (separado por vírgulas)" grava em Windows-1252.
    return { text: iconv.decode(body, 'win1252'), encoding: 'windows-1252' };
  }
}

/** O mais frequente entre `;`, `,` e tab na linha, fora de aspas; empate (ou nenhum) ⇒ `;`. */
export function detectDelimiter(firstLine: string): ';' | ',' | '\t' {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char as keyof typeof counts]++;
  }
  if (counts[','] > counts[';'] && counts[','] >= counts['\t']) return ',';
  if (counts['\t'] > counts[';'] && counts['\t'] > counts[',']) return '\t';
  return ';';
}

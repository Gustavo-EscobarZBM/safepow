import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Writable } from 'stream';
import { protectFormula } from '../../common/csv';
import { ExportResourceHandler } from './export-handler';
import { EXPORT_PAGE_SIZE, exportFileName, formatCsvValue, streamExport } from './export-writer';

interface Row {
  id: string;
  name: string;
  price: string | null;
}

/** Resposta HTTP falsa: guarda cabeçalhos e bytes. */
class FakeResponse extends Writable {
  constructor(opts: { highWaterMark?: number } = {}) {
    super(opts);
  }
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  headersSent = false;
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  _write(chunk: Buffer, _enc: string, done: () => void) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    done();
  }
  body(): Buffer {
    return Buffer.concat(this.chunks);
  }
  finished(): Promise<void> {
    return new Promise((resolve) => (this.writableFinished ? resolve() : this.on('finish', () => resolve())));
  }
}

/** Cliente que não lê nada (buffer mínimo): toda escrita fica pendente. */
class StalledResponse extends FakeResponse {
  constructor() {
    super({ highWaterMark: 1 });
  }
  _write(_chunk: Buffer, _enc: string, _done: () => void) {
    this.headersSent = true;
  }
}

function handler(rows: Row[]): ExportResourceHandler<Row> & { afterIds: (string | null)[] } {
  const afterIds: (string | null)[] = [];
  return {
    afterIds,
    fileBase: 'produtos',
    sheetName: 'Produtos',
    columns: [
      { header: 'Nome', type: 'text', value: (row) => row.name },
      { header: 'Preço', type: 'money', value: (row) => row.price },
    ],
    count: async () => rows.length,
    page: async (_m, _f, afterId, limit) => {
      afterIds.push(afterId);
      const start = afterId === null ? 0 : rows.findIndex((row) => row.id === afterId) + 1;
      return rows.slice(start, start + limit);
    },
  };
}

const manager = {} as never;

describe('protectFormula', () => {
  it.each(['=A1', '+55', '-5', '@x', '\tx', '\rx'])('%j recebe apóstrofo', (text) => {
    expect(protectFormula(text)).toBe(`'${text}`);
  });
  it('texto normal fica igual', () => {
    expect(protectFormula('Arroz 5kg')).toBe('Arroz 5kg');
  });
});

describe('formatCsvValue', () => {
  it('dinheiro com vírgula e 2 casas; vazio', () => {
    expect(formatCsvValue('money', '10.5')).toBe('10,50');
    expect(formatCsvValue('money', null)).toBe('');
  });
  it('custo com 2 a 4 casas (SP4 4.1)', () => {
    expect(formatCsvValue('cost', '3.1234')).toBe('3,1234');
    expect(formatCsvValue('cost', '6.0000')).toBe('6,00');
    expect(formatCsvValue('cost', '6.5000')).toBe('6,50');
    expect(formatCsvValue('cost', '0.1230')).toBe('0,123');
  });
  it('data e hora de São Paulo', () => {
    expect(formatCsvValue('datetime', new Date('2026-09-28T15:04:00Z'))).toBe('28/09/2026 12:04');
  });
  it('texto protegido contra fórmula', () => {
    expect(formatCsvValue('text', '=1+1')).toBe("'=1+1");
  });
});

describe('exportFileName', () => {
  it('usa a data de São Paulo', () => {
    expect(exportFileName('produtos', 'xlsx', new Date('2026-09-28T02:00:00Z'))).toBe('produtos-2026-09-27.xlsx');
  });
});

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, '0'), name: `P${i}`, price: '1.00' }));

describe('streamExport', () => {
  it('csv: BOM, ; e CRLF; páginas por keyset', async () => {
    const res = new FakeResponse();
    const h = handler(rows(2500));
    await streamExport(res as never, h, {}, 'csv', { manager });
    await res.finished();
    const text = res.body().toString('utf8');
    expect(text.startsWith('﻿Nome;Preço\r\nP0;1,00\r\n')).toBe(true);
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(2501);
    expect(h.afterIds).toEqual([null, rows(2500)[EXPORT_PAGE_SIZE - 1].id]);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="produtos-\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  it('acima do limite: EXPORT_TOO_LARGE antes de escrever qualquer coisa', async () => {
    const res = new FakeResponse();
    const error = await streamExport(res as never, handler(rows(3)), {}, 'csv', { manager, maxRows: 2 }).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ errorCode: 'EXPORT_TOO_LARGE' });
    expect(res.headers).toEqual({});
    expect(res.chunks).toHaveLength(0);
  });

  it('xlsx: cabeçalhos, texto protegido e preço como número', async () => {
    const res = new FakeResponse();
    await streamExport(res as never, handler([{ id: '1', name: '=HYPERLINK("x")', price: '12.5' }]), {}, 'xlsx', { manager });
    await res.finished();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body() as never);
    const sheet = workbook.getWorksheet('Produtos')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Nome', 'Preço']);
    expect(sheet.getCell('A2').value).toBe('\'=HYPERLINK("x")');
    expect(sheet.getCell('B2').value).toBe(12.5);
    expect(sheet.getCell('B2').numFmt).toBe('0.00');
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('erro no meio (depois dos cabeçalhos): a resposta é destruída, não encerrada como sucesso', async () => {
    const res = new FakeResponse();
    const h = handler(rows(5000));
    const original = h.page;
    let calls = 0;
    h.page = async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('banco caiu');
      return original(...args);
    };
    await expect(streamExport(res as never, h, {}, 'csv', { manager })).rejects.toThrow('banco caiu');
    expect(res.destroyed).toBe(true);
    expect(res.writableEnded).toBe(false);
  });

  it('cliente desconecta no meio: termina (sem travar) e para de ler páginas', async () => {
    const res = new StalledResponse();
    const h = handler(rows(10_000));
    const done = streamExport(res as never, h, {}, 'csv', { manager }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 20));
    res.destroy();
    const result = await Promise.race([done, new Promise((r) => setTimeout(() => r('TRAVOU'), 1000))]);
    expect(result).not.toBe('TRAVOU');
    expect(h.afterIds.length).toBeLessThan(5);
  });

  it('xlsx com cliente lento: não gera as páginas seguintes enquanto a resposta não drena', async () => {
    const res = new StalledResponse();
    const h = handler(rows(40_000));
    void streamExport(res as never, h, {}, 'xlsx', { manager }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    // Sem pressão de volta o exceljs gera as 20 páginas na memória; com ela, para poucas páginas à frente.
    expect(h.afterIds.length).toBeLessThanOrEqual(4);
    res.destroy();
  });
});

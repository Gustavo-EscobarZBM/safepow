import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { EntityManager } from 'typeorm';
import { csvLine, protectFormula } from '../../common/csv';
import { getTenantManager } from '../../common/tenant/tenant-storage';
import { ExportCellType, ExportFormat, ExportResourceHandler } from './export-handler';

export const EXPORT_PAGE_SIZE = 2000;
export const EXPORT_MAX_ROWS = 200_000;

const TIME_ZONE = 'America/Sao_Paulo';
const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};
const XLSX_FORMATS: Record<ExportCellType, string> = { text: '@', money: '0.00', datetime: 'dd/mm/yyyy hh:mm' };

function parts(date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** `produtos-2026-09-27.xlsx`, com a data de São Paulo. */
export function exportFileName(fileBase: string, format: ExportFormat, now: Date = new Date()): string {
  const p = parts(now);
  return `${fileBase}-${p.year}-${p.month}-${p.day}.${format}`;
}

/** Valor de célula no CSV: dinheiro `12,50`, data `dd/mm/aaaa hh:mm` (São Paulo), texto protegido contra fórmula. */
export function formatCsvValue(type: ExportCellType, value: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money') return Number(value).toFixed(2).replace('.', ',');
  if (type === 'datetime') {
    const p = parts(value instanceof Date ? value : new Date(value));
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  }
  return protectFormula(String(value));
}

/** O xlsx guarda datas sem fuso: grava o "relógio de São Paulo" como se fosse UTC, que o Excel mostra como está. */
function xlsxDate(value: Date): Date {
  const p = parts(value);
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}

function xlsxValue(type: ExportCellType, value: string | number | Date | null): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'money') return Number(value);
  if (type === 'datetime') return xlsxDate(value instanceof Date ? value : new Date(value));
  return protectFormula(String(value));
}

/** O cliente foi embora (ou a resposta foi destruída): parar sem gravar mais nada. */
class ClientGone extends Error {
  constructor() {
    super('O cliente fechou a conexão durante a exportação.');
  }
}

function alive(res: Response): void {
  if (res.destroyed || res.writableEnded) throw new ClientGone();
}

/**
 * Espera a resposta drenar. `drain` nunca chega se o cliente desconectar — por isso `close` também encerra a espera
 * (sem isso a exportação travaria para sempre segurando a transação e a conexão do pool).
 */
function waitDrain(res: Response): Promise<void> {
  alive(res);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new ClientGone());
    };
    res.on('drain', onDrain);
    res.on('close', onClose);
    res.on('error', onClose);
  });
}

async function write(res: Response, chunk: string): Promise<void> {
  alive(res);
  if (!res.write(chunk)) await waitDrain(res);
}

/** Resolve quando `promise` terminar; rejeita se a resposta fechar antes (o `commit` do exceljs espera o `finish`). */
function unlessClosed<T>(res: Response, promise: Promise<T>): Promise<T> {
  alive(res);
  return new Promise((resolve, reject) => {
    const onClose = () => {
      if (!res.writableFinished) reject(new ClientGone());
    };
    res.once('close', onClose);
    promise.then(
      (value) => {
        res.off('close', onClose);
        resolve(value);
      },
      (error) => {
        res.off('close', onClose);
        reject(error);
      },
    );
  });
}

/**
 * Exportação em streaming (SP3, spec 4 / I6): conta antes (acima do limite ⇒ 400 sem tocar na resposta), depois lê
 * páginas de 2.000 por keyset e escreve direto na resposta — xlsx pelo WorkbookWriter do exceljs, CSV com `;`, BOM
 * e CRLF. A resposta termina com `res.end` (o middleware do tenant fecha a transação ali).
 *
 * Falha depois dos cabeçalhos (banco, cliente que desconectou): a resposta é DESTRUÍDA — nunca encerrada com 200 — para
 * o cliente não receber um arquivo truncado como se estivesse completo. O xlsx respeita a pressão de volta da resposta
 * entre as páginas (sem isso o exceljs geraria a planilha inteira na memória com um cliente lento).
 */
export async function streamExport<R extends { id: string }, F>(
  res: Response,
  handler: ExportResourceHandler<R, F>,
  filters: F,
  format: ExportFormat,
  opts: { maxRows?: number; manager?: EntityManager } = {},
): Promise<void> {
  const manager = opts.manager ?? getTenantManager();
  const maxRows = opts.maxRows ?? EXPORT_MAX_ROWS;
  const total = await handler.count(manager, filters);
  if (total > maxRows) {
    throw new BadRequestException({
      statusCode: 400,
      errorCode: 'EXPORT_TOO_LARGE',
      message: `A exportação passa de ${maxRows.toLocaleString('pt-BR')} linhas. Filtre antes de exportar.`,
    });
  }

  res.setHeader('Content-Type', CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(handler.fileBase, format)}"`);

  const pages = async function* () {
    let afterId: string | null = null;
    for (;;) {
      const rows = await handler.page(manager, filters, afterId, EXPORT_PAGE_SIZE);
      if (rows.length) yield rows;
      if (rows.length < EXPORT_PAGE_SIZE) return;
      afterId = rows[rows.length - 1].id;
    }
  };

  try {
    if (format === 'csv') await writeCsv(res, handler, pages());
    else await writeXlsx(res, handler, pages());
  } catch (error) {
    // Sem o erro no destroy: ele viraria um 'error' sem ouvinte; o erro segue para o Nest registrar.
    if (!res.destroyed) res.destroy();
    if (error instanceof ClientGone) return;
    throw error;
  }
}

async function writeCsv<R extends { id: string }, F>(
  res: Response,
  handler: ExportResourceHandler<R, F>,
  pages: AsyncGenerator<R[]>,
): Promise<void> {
  await write(res, '\uFEFF' + csvLine(handler.columns.map((c) => c.header)) + '\r\n');
  for await (const rows of pages) {
    alive(res);
    const lines = rows.map(
      (row) => handler.columns.map((c) => csvCellRaw(formatCsvValue(c.type, c.value(row)))).join(';') + '\r\n',
    );
    await write(res, lines.join(''));
  }
  res.end();
}

async function writeXlsx<R extends { id: string }, F>(
  res: Response,
  handler: ExportResourceHandler<R, F>,
  pages: AsyncGenerator<R[]>,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  const sheet = workbook.addWorksheet(handler.sheetName);
  sheet.columns = handler.columns.map((c) => ({
    header: c.header,
    width: c.width ?? 20,
    style: { numFmt: XLSX_FORMATS[c.type] },
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).commit();
  for await (const rows of pages) {
    alive(res);
    for (const row of rows) sheet.addRow(handler.columns.map((c) => xlsxValue(c.type, c.value(row)))).commit();
    // Deixa o zip entregar o que já gerou e, se a resposta estiver cheia, espera o cliente ler antes da próxima página.
    await new Promise((resolve) => setImmediate(resolve));
    if (res.writableNeedDrain) await waitDrain(res);
  }
  sheet.commit();
  await unlessClosed(res, workbook.commit());
}

/** Aspas do CSV para um valor já formatado (a proteção de fórmula já foi aplicada). */
function csvCellRaw(text: string): string {
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

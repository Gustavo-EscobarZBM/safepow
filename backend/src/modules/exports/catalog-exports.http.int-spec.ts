jest.mock('@nestjs/bullmq', () => require('../../test-utils/bullmq-mock'));

import { INestApplication } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { seedUser, tokenFor } from '../../test-utils/approvals-test-app';
import { startImportsApp } from '../../test-utils/imports-test-app';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { LossLocationsController } from '../loss-locations/loss-locations.controller';
import { LossLocationsService } from '../loss-locations/loss-locations.service';
import { LossReasonsController } from '../loss-reasons/loss-reasons.controller';
import { LossReasonsService } from '../loss-reasons/loss-reasons.service';
import { UserRole } from '../users/user.entity';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';

describe('Exportação de motivos, locais e usuários (SP3, 3.3)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let token: string;
  let employeeToken: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startImportsApp({
      controllers: [LossReasonsController, LossLocationsController, UsersController],
      providers: [LossReasonsService, LossLocationsService, UsersService],
    }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Cadastros');
    token = await tokenFor(await seedUser(companyId, 'manager', { name: 'Ana Gerente' }), companyId);
    employeeToken = await tokenFor(await seedUser(companyId, 'employee', { name: 'João' }), companyId, UserRole.EMPLOYEE);
  });

  async function download(path: string, asToken = token) {
    const response = await fetch(`${baseUrl}/api/${path}`, { headers: { Authorization: `Bearer ${asToken}` } });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  }

  async function rowsOf(body: Buffer, sheetName: string): Promise<ExcelJS.CellValue[][]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as never);
    return (workbook.getWorksheet(sheetName)!.getSheetValues().slice(1) as ExcelJS.CellValue[][]).map((row) => row.slice(1));
  }

  it('motivos em csv: Nome e Criado em (São Paulo), nome protegido contra fórmula', async () => {
    await adminQuery(
      `INSERT INTO loss_reasons ("companyId", name, "createdAt") VALUES ($1, '+Avaria', '2026-09-28T15:04:00Z')`,
      [companyId],
    );
    const { status, headers, body } = await download('loss-reasons/export?format=csv');
    expect(status).toBe(200);
    expect(headers.get('content-disposition')).toMatch(/filename="motivos-de-perda-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(body.toString('utf8')).toBe("﻿Nome;Criado em\r\n'+Avaria;28/09/2026 12:04\r\n");
  });

  it('locais em xlsx', async () => {
    await adminQuery(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, 'Depósito'), ($1, 'Loja')`, [companyId]);
    const { status, headers, body } = await download('loss-locations/export');
    expect(status).toBe(200);
    expect(headers.get('content-disposition')).toMatch(/filename="locais-de-perda-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const rows = await rowsOf(body, 'Locais de perda');
    expect(rows[0]).toEqual(['Nome', 'Criado em']);
    expect(rows.slice(1).map((row) => row[0]).sort()).toEqual(['Depósito', 'Loja']);
    expect(rows[1][1]).toBeInstanceOf(Date);
  });

  it('usuários: só da empresa, papel e situação traduzidos, sem senha', async () => {
    await adminQuery(`UPDATE users SET "passwordHash" = '$2b$10$abcdefghijklmnopqrstuv' WHERE "companyId" = $1`, [companyId]);
    const inactive = await seedUser(companyId, 'employee', { name: 'Inativo', isActive: false });
    await seedUser(await seedCompany('Outra'), 'manager', { name: 'De outra empresa' });
    const { status, headers, body } = await download('users/export');
    expect(status).toBe(200);
    expect(headers.get('content-disposition')).toMatch(/filename="usuarios-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(body.includes(Buffer.from('$2b$'))).toBe(false);
    const rows = await rowsOf(body, 'Usuários');
    expect(rows[0]).toEqual(['Nome', 'E-mail', 'Papel', 'Situação', 'Criado em']);
    const byName = Object.fromEntries(rows.slice(1).map((row) => [row[0], row]));
    expect(Object.keys(byName).sort()).toEqual(['Ana Gerente', 'Inativo', 'João']);
    expect(byName['Ana Gerente'][2]).toBe('Gerente');
    expect(byName['João'][2]).toBe('Funcionário');
    expect(byName['João'][3]).toBe('Ativo');
    expect(byName['Inativo'][3]).toBe('Inativo');
    expect(inactive).toEqual(expect.any(String));
  });

  it.each(['loss-reasons/export', 'loss-locations/export', 'users/export'])('funcionário em %s ⇒ 403', async (path) => {
    expect((await download(path, employeeToken)).status).toBe(403);
  });
});

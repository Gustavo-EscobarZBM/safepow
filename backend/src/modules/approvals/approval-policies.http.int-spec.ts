import { INestApplication } from '@nestjs/common';
import { adminQuery, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { http, seedUser, startApprovalsApp, tokenFor } from '../../test-utils/approvals-test-app';
import { ApprovalPoliciesController } from './approval-policies.controller';

const ALL_ON = {
  price_change: { enabled: true, thresholdPercent: 30 },
  retro_fix: { enabled: true },
  loss_edit: { enabled: false },
  archive_with_history: { enabled: true },
};

describe('Configuração das políticas de aprovação (SP2, 2.2.1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let companyId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApprovalsApp({ controllers: [ApprovalPoliciesController] }));
  });
  afterAll(async () => {
    await app.close();
    await closeTestConnections();
  });
  beforeEach(async () => {
    await truncateAll();
    companyId = await seedCompany('Empresa Config');
    token = await tokenFor(await seedUser(companyId), companyId);
  });

  it('padrão: tudo desligado, limite 20, 1 gerente ⇒ modo justificativa', async () => {
    const { status, body } = await http(baseUrl, 'GET', '/api/approval-policies', token);
    expect(status).toBe(200);
    expect(body).toEqual({
      policies: {
        price_change: { enabled: false, thresholdPercent: 20 },
        retro_fix: { enabled: false },
        loss_edit: { enabled: false },
        archive_with_history: { enabled: false },
      },
      activeManagers: 1,
      mode: 'justification',
    });
  });

  it('PUT grava, devolve o modo atual e a mudança é auditada com o autor', async () => {
    await seedUser(companyId);
    const { status, body } = await http(baseUrl, 'PUT', '/api/approval-policies', token, ALL_ON);

    expect(status).toBe(200);
    expect(body).toEqual({ policies: ALL_ON, activeManagers: 2, mode: 'approval' });
    const [row] = await adminQuery(`SELECT "approvalPolicies" FROM companies WHERE id = $1`, [companyId]);
    expect(row.approvalPolicies).toEqual(ALL_ON);
    const [audit] = await adminQuery(
      `SELECT changes, "actorUserId" FROM audit_log WHERE "entityType" = 'company' AND action = 'update' ORDER BY seq DESC LIMIT 1`,
    );
    expect(audit.changes[0].field).toBe('approvalPolicies');
    expect(audit.actorUserId).not.toBeNull();
  });

  it.each([
    ['limite zero', { ...ALL_ON, price_change: { enabled: true, thresholdPercent: 0 } }],
    ['chave desconhecida', { ...ALL_ON, qualquer: { enabled: true } }],
    ['política faltando', { price_change: ALL_ON.price_change }],
    ['enabled não booleano', { ...ALL_ON, loss_edit: { enabled: 'sim' } }],
  ])('PUT com %s ⇒ 400', async (_label, payload) => {
    expect((await http(baseUrl, 'PUT', '/api/approval-policies', token, payload)).status).toBe(400);
  });

  it('funcionário não acessa (403)', async () => {
    const employeeToken = await tokenFor(await seedUser(companyId, 'employee'), companyId, 'employee' as never);
    expect((await http(baseUrl, 'GET', '/api/approval-policies', employeeToken)).status).toBe(403);
  });
});

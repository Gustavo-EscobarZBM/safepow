import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { DataSource, QueryRunner } from 'typeorm';
import { UserRole } from '../../modules/users/user.entity';
import { adminQuery, appDataSource, closeTestConnections, seedCompany, truncateAll } from '../../test-utils/test-db';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { getTenantContext, getTenantManager } from './tenant-storage';

const JWT_SECRET = 'segredo-somente-de-teste';
const COMMIT_DELAY_MS = 300;

/**
 * DataSource cujos QueryRunners têm o commit substituído. `makeCommit` recebe o QueryRunner e o
 * commit real (já ligado a ele) e devolve o commit que será usado no lugar.
 */
function withCommitOverride(
  dataSource: DataSource,
  makeCommit: (queryRunner: QueryRunner, realCommit: () => Promise<void>) => () => Promise<void>,
): DataSource {
  return new Proxy(dataSource, {
    get(target, property) {
      if (property === 'createQueryRunner') {
        return (...args: Parameters<DataSource['createQueryRunner']>) => {
          const queryRunner = target.createQueryRunner(...args);
          queryRunner.commitTransaction = makeCommit(queryRunner, queryRunner.commitTransaction.bind(queryRunner));
          return queryRunner;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** DataSource cujo commit demora: alarga a janela entre "resposta enviada" e "transação gravada". */
function withSlowCommit(dataSource: DataSource, delayMs: number): DataSource {
  return withCommitOverride(dataSource, (_queryRunner, realCommit) => async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await realCommit();
  });
}

/** DataSource cujo commit sempre falha (a transação é desfeita, como no Postgres). */
function withFailingCommit(dataSource: DataSource): DataSource {
  return withCommitOverride(dataSource, (queryRunner) => async () => {
    await queryRunner.rollbackTransaction();
    throw new Error('commit simulado falhou');
  });
}

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function insertProduct(barcode: string): Promise<void> {
  const { companyId } = getTenantContext();
  await getTenantManager().query(
    `INSERT INTO products ("companyId", barcode, name) VALUES ($1, $2, 'Produto F16')`,
    [companyId, barcode],
  );
}

async function insertProductAndRespond(res: express.Response, status: number, barcode: string): Promise<void> {
  try {
    await insertProduct(barcode);
    res.status(status).json({ ok: status < 400 });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

/**
 * Responde e, em seguida, faz o que o filtro de exceções do Nest faz quando um erro chega depois
 * de a resposta já ter sido enviada: consulta `headersSent` e só responde de novo se ainda não saiu.
 */
async function insertProductAndRespondTwice(res: express.Response, barcode: string): Promise<void> {
  try {
    await insertProduct(barcode);
    res.status(201).json({ ok: true });
    if (!res.headersSent) {
      res.status(500).json({ late: true });
    } else {
      res.end();
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

async function startServer(dataSource: DataSource): Promise<TestServer> {
  const middleware = new TenantContextMiddleware(new JwtService({ secret: JWT_SECRET }), dataSource);
  const app = express();
  app.use((req, res, next) => {
    void middleware.use(req, res, next);
  });
  app.post('/created', (_req, res) => void insertProductAndRespond(res, 201, 'F16-COMMIT'));
  app.post('/conflict', (_req, res) => void insertProductAndRespond(res, 409, 'F16-ROLLBACK'));
  app.post('/double', (_req, res) => void insertProductAndRespondTwice(res, 'F16-DOUBLE'));
  app.post('/user-setting', (_req, res) => {
    void getTenantManager()
      .query(`SELECT current_setting('app.current_user_id', true) AS value`)
      .then((rows: { value: string | null }[]) => res.status(200).json({ value: rows[0].value }));
  });
  // Corpo de tipo inválido: nosso `end` adia a chamada, e o `end` real só lança depois do commit.
  app.post('/invalid-end', (_req, res) => {
    res.status(200);
    (res.end as (chunk: unknown) => unknown)(123);
  });

  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Resolve quando o corpo da resposta terminou de chegar ao cliente. */
function post(baseUrl: string, path: string, token: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

describe('TenantContextMiddleware — a resposta só sai depois do commit (F16)', () => {
  let token: string;

  beforeEach(async () => {
    await truncateAll();
    const companyId = await seedCompany('Empresa F16');
    token = await new JwtService({ secret: JWT_SECRET }).signAsync({
      sub: '00000000-0000-4000-8000-000000000001',
      role: UserRole.MANAGER,
      companyId,
    });
  });

  afterAll(() => closeTestConnections());

  describe('com commit lento', () => {
    let server: TestServer;
    beforeAll(async () => {
      server = await startServer(withSlowCommit(await appDataSource(), COMMIT_DELAY_MS));
    });
    afterAll(() => server.close());
    afterEach(() => jest.restoreAllMocks());

    it('a linha gravada já está visível quando a resposta 2xx chega ao cliente', async () => {
      const { status } = await post(server.baseUrl, '/created', token);
      expect(status).toBe(201);

      // Lido por outra conexão (superusuário), no instante em que a resposta chegou.
      const rows = await adminQuery(`SELECT 1 FROM products WHERE barcode = 'F16-COMMIT'`);
      expect(rows).toHaveLength(1);
    });

    it('resposta de erro (409) desfaz a transação: nada é gravado', async () => {
      const { status } = await post(server.baseUrl, '/conflict', token);
      expect(status).toBe(409);

      await new Promise((resolve) => setTimeout(resolve, COMMIT_DELAY_MS + 200)); // qualquer commit tardio já teria ocorrido
      const rows = await adminQuery(`SELECT 1 FROM products WHERE barcode = 'F16-ROLLBACK'`);
      expect(rows).toHaveLength(0);
    });

    it('um segundo end (filtro de exceções após resposta enviada) é ignorado: a primeira resposta vale e nada estoura', async () => {
      const { status, body } = await post(server.baseUrl, '/double', token);

      // Sem a guarda, o `end` tardio troca o status por 500, corrompe o corpo/Content-Length e emite
      // ERR_STREAM_WRITE_AFTER_END sem listener (exceção não capturada que derruba o processo).
      expect(status).toBe(201);
      expect(body).toBe('{"ok":true}');
      const rows = await adminQuery(`SELECT 1 FROM products WHERE barcode = 'F16-DOUBLE'`);
      expect(rows).toHaveLength(1);
    });

    it(
      'falha ao entregar a resposta depois do commit: registra o erro e fecha a conexão, sem derrubar o processo',
      async () => {
        const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        // O `end` real lança (ERR_INVALID_ARG_TYPE) dentro do `.then` do middleware: sem um `.catch`
        // final isso vira unhandledRejection (derruba o Node >= 15) e o cliente fica pendurado.
        await expect(post(server.baseUrl, '/invalid-end', token)).rejects.toThrow();

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('Falha ao entregar a resposta'));
      },
      10_000,
    );
  });

  describe('com commit que falha', () => {
    let server: TestServer;
    beforeAll(async () => {
      server = await startServer(withFailingCommit(await appDataSource()));
    });
    afterAll(() => server.close());

    it('o cliente recebe 500 (não um sucesso que não foi gravado) e nada é gravado', async () => {
      const { status } = await post(server.baseUrl, '/created', token);

      expect(status).toBe(500);
      const rows = await adminQuery(`SELECT 1 FROM products WHERE barcode = 'F16-COMMIT'`);
      expect(rows).toHaveLength(0);
    });
  });
});

describe('TenantContextMiddleware — app.current_user_id para o histórico de preço', () => {
  const USER_ID = '00000000-0000-4000-8000-000000000002';
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer(await appDataSource());
  });
  afterAll(async () => {
    await server.close();
    await closeTestConnections();
  });

  it('define app.current_user_id com o sub do token', async () => {
    await truncateAll();
    const companyId = await seedCompany('Empresa Usuário');
    const token = await new JwtService({ secret: JWT_SECRET }).signAsync({
      sub: USER_ID,
      role: UserRole.MANAGER,
      companyId,
    });

    const { status, body } = await post(server.baseUrl, '/user-setting', token);

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ value: USER_ID });
  });
});

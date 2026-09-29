import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

dotenv.config();

const SALT_ROUNDS = 12;

/** Contas dos botões de login rápido da tela de login (web-panel/src/app/login/page.tsx, QUICK_LOGINS). */
const DEMO_USERS = [
  { name: 'Gerente Demo', email: 'gerente.demo@safepow.com', password: '123456', role: 'manager' },
  { name: 'Funcionario Demo', email: 'funcionario.demo@safepow.com', password: 'demo1234', role: 'employee' },
];

const LOSS_REASONS = ['Erro operacional', 'Furto', 'Outro', 'Quebra/Avaria', 'Vencimento/Validade'];
const LOSS_LOCATIONS = [
  'Caixa/Frente de loja',
  'Câmara fria',
  'Depósito/Estoque',
  'Loja/Gôndola',
  'Outro',
  'Recebimento de mercadoria',
];

/**
 * Empresa de demonstração para uma instalação nova (banco limpo): "Empresa Demo" com gerente, funcionário, motivos
 * e locais de perda — o mesmo cenário do ambiente de desenvolvimento original. Roda depois do seed do master.
 * Idempotente: se o gerente demo já existe, não faz nada. SÓ PARA DESENVOLVIMENTO/DEMONSTRAÇÃO (senhas fixas).
 *
 * Usa o role de runtime (RLS ativa), como o seed do master: o contexto da empresa é ligado na transação com
 * set_config('app.current_company_id', …, true), igual ao TenantContextMiddleware.
 */
async function seedDemo() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_APP_USER,
    password: process.env.DB_APP_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await dataSource.initialize();

  try {
    const [existing] = await dataSource.query(`SELECT id FROM auth_lookup_user_by_email($1)`, [DEMO_USERS[0].email]).catch(() => []);
    if (existing) {
      console.log('Empresa Demo já existe (gerente.demo@safepow.com). Nada a fazer.');
      return;
    }

    const companyId = randomUUID();
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]);
      await manager.query(`INSERT INTO companies (id, name, status, "planTier") VALUES ($1, 'Empresa Demo', 'active', 'pro')`, [
        companyId,
      ]);
      for (const user of DEMO_USERS) {
        await manager.query(
          `INSERT INTO users (name, email, "passwordHash", role, "companyId") VALUES ($1, $2, $3, $4, $5)`,
          [user.name, user.email, await bcrypt.hash(user.password, SALT_ROUNDS), user.role, companyId],
        );
      }
      for (const name of LOSS_REASONS) {
        await manager.query(`INSERT INTO loss_reasons ("companyId", name) VALUES ($1, $2)`, [companyId, name]);
      }
      for (const name of LOSS_LOCATIONS) {
        await manager.query(`INSERT INTO loss_locations ("companyId", name) VALUES ($1, $2)`, [companyId, name]);
      }
    });

    console.log('Empresa Demo criada: gerente.demo@safepow.com / 123456 e funcionario.demo@safepow.com / demo1234.');
  } finally {
    await dataSource.destroy();
  }
}

seedDemo().catch((err) => {
  console.error('Falha ao rodar o seed de demonstração:', err);
  process.exit(1);
});

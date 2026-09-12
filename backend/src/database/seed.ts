import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Company } from '../modules/companies/company.entity';
import { User, UserRole } from '../modules/users/user.entity';
import { Product } from '../modules/products/product.entity';
import { LossLocation } from '../modules/loss-locations/loss-location.entity';
import { LossReason } from '../modules/loss-reasons/loss-reason.entity';
import { Loss } from '../modules/losses/loss.entity';
import { ImportJob } from '../modules/imports/import-job.entity';

dotenv.config();

const SALT_ROUNDS = 12;

/**
 * Roda com as credenciais de RUNTIME (DB_APP_USER), as mesmas que o backend usa
 * — de propósito: assim testamos, já no seed, que o role restrito realmente
 * consegue inserir o master admin sob a política de RLS (Seção 1.2/6.1).
 */
async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_APP_USER,
    password: process.env.DB_APP_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    entities: [Company, User, Product, Loss, ImportJob, LossReason, LossLocation],
  });

  await dataSource.initialize();

  const usersRepository = dataSource.getRepository(User);

  const email = process.env.MASTER_ADMIN_EMAIL || 'master@seusistema.com.br';
  const existing = await usersRepository.findOne({ where: { email } });

  if (existing) {
    console.log(`Usuário master admin já existe (${email}). Nada a fazer.`);
    await dataSource.destroy();
    return;
  }

  const passwordHash = await bcrypt.hash(
    process.env.MASTER_ADMIN_PASSWORD || 'troque-esta-senha',
    SALT_ROUNDS,
  );

  const masterAdmin = usersRepository.create({
    companyId: null,
    name: 'Administrador Master',
    email,
    passwordHash,
    role: UserRole.MASTER_ADMIN,
  });
  await usersRepository.save(masterAdmin);

  console.log(`Usuário master admin criado com sucesso: ${email}`);
  console.log('Troque a senha padrão assim que possível (MASTER_ADMIN_PASSWORD no .env).');

  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Falha ao rodar o seed:', err);
  process.exit(1);
});

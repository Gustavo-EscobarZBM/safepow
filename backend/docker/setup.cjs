// Executado uma vez por inicializacao, antes da API. Usa o JS compilado da mesma imagem.
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');

async function main() {
  if (process.env.DB_APP_USER !== 'inventory_saas_app') {
    throw new Error('DB_APP_USER deve ser inventory_saas_app (role usado pelas migrations).');
  }
  const admin = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD,
    connectionTimeoutMillis: 10000,
  });
  await admin.connect();
  try {
    // Nunca muda a senha de um role existente: credenciais divergentes precisam ser corrigidas no .env.
    const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'inventory_saas_app'");
    if (!role.rowCount) {
      const { rows } = await admin.query("SELECT format('CREATE ROLE inventory_saas_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', $1::text) AS sql", [process.env.DB_APP_PASSWORD]);
      await admin.query(rows[0].sql);
    }
    const runtime = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
      user: process.env.DB_APP_USER, password: process.env.DB_APP_PASSWORD, connectionTimeoutMillis: 10000 });
    try { await runtime.connect(); } finally { await runtime.end(); }
    await admin.query('GRANT USAGE ON SCHEMA public TO inventory_saas_app');
    await admin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inventory_saas_app');
    await admin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO inventory_saas_app');
  } finally { await admin.end(); }

  for (const args of [
    ['node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/database/data-source.js'],
    ['dist/database/seed.js'],
    ...(process.env.SAFEPOW_SEED_DEMO === 'true' ? [['dist/database/seed-demo.js']] : []),
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
    if (result.error || result.status !== 0) throw new Error(`Falha na preparacao: ${args[0]}`);
  }
  console.log('Banco preparado. API liberada para iniciar.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

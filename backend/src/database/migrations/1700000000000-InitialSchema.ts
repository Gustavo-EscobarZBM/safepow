import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema inicial do sistema multi-tenant (Seção 1.2 do documento de arquitetura).
 *
 * Estratégia adotada: banco único, coluna companyId (tenant_id) em cada tabela
 * de dados de negócio, reforçada por Row Level Security (RLS) nativo do
 * PostgreSQL — isolamento em duas camadas: aplicação (WHERE companyId = ...)
 * E banco de dados (RLS), para que um bug de query nunca vaze dados entre empresas.
 *
 * A RLS compara a coluna companyId com a variável de sessão `app.current_company_id`,
 * que o backend define no início de cada requisição (ver src/common/middleware/tenant-context.middleware.ts
 * e src/database/tenant-connection.provider.ts).
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ---------- Enums ----------
    await queryRunner.query(`
      CREATE TYPE "company_status_enum" AS ENUM ('trial', 'active', 'past_due', 'blocked', 'canceled')
    `);
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('master_admin', 'manager', 'employee')
    `);

    // ---------- companies (tenants) ----------
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(180) NOT NULL,
        "cnpj" varchar(18) UNIQUE,
        "status" company_status_enum NOT NULL DEFAULT 'trial',
        "planTier" varchar(60) NOT NULL DEFAULT 'starter',
        "currentPeriodEnd" timestamptz,
        "billingProviderCustomerId" varchar(120),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ---------- users ----------
    // companyId é NULL apenas para master_admin (equipe do fornecedor do SaaS).
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
        "name" varchar(150) NOT NULL,
        "email" varchar(180) NOT NULL,
        "passwordHash" varchar NOT NULL,
        "role" user_role_enum NOT NULL DEFAULT 'employee',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")
    `);

    // ---------- products ----------
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "barcode" varchar(64) NOT NULL,
        "sku" varchar(60),
        "name" varchar(200) NOT NULL,
        "unitPrice" numeric(12,2) NOT NULL DEFAULT 0,
        "sourceColumnMapping" jsonb,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_products_company_barcode" ON "products" ("companyId", "barcode")
    `);

    // ---------- losses ----------
    await queryRunner.query(`
      CREATE TABLE "losses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "clientGeneratedId" uuid NOT NULL,
        "productId" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
        "reportedByUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "quantity" numeric(12,3) NOT NULL DEFAULT 1,
        "location" varchar(150) NOT NULL,
        "description" text NOT NULL,
        "imageUrl" varchar(500),
        "occurredAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_losses_company_client_id" ON "losses" ("companyId", "clientGeneratedId")
    `);
    await queryRunner.query(`CREATE INDEX "idx_losses_company_occurred_at" ON "losses" ("companyId", "occurredAt")`);
    await queryRunner.query(`CREATE INDEX "idx_losses_product" ON "losses" ("productId")`);

    // ---------- Row Level Security ----------
    // Ativa RLS e cria uma política por tabela de dados de negócio. A política usa
    // current_setting('app.current_company_id', true) — o "true" faz retornar NULL
    // em vez de erro quando a variável não foi definida (ex: conexões administrativas
    // do próprio backend para o Painel Master, que fazem BYPASS via role separada).
    for (const table of ['users', 'products', 'losses']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      // FORCE garante que a política vale mesmo para o DONO da tabela — sem isso,
      // o dono de uma tabela ignora RLS por padrão no PostgreSQL, o que é um erro
      // comum: a política pareceria funcionar em testes rodados como owner/superuser
      // e falharia silenciosamente em produção só quando um role diferente conectasse.
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);

      if (table === 'users') {
        // Caso especial: usuários MASTER_ADMIN têm companyId NULL (não pertencem a
        // nenhuma empresa — Seção 6.1). Esta política adiciona uma segunda condição:
        // uma linha com companyId NULL só é visível quando a sessão TAMBÉM não tem
        // app.current_company_id definido (ou seja, uma sessão de master admin ou
        // uma conexão administrativa sem contexto de tenant — nunca a sessão de um
        // funcionário/gerente comum, que sempre tem companyId definido pelo middleware).
        await queryRunner.query(`
          CREATE POLICY "tenant_isolation_users" ON "users"
          USING (
            "companyId" = current_setting('app.current_company_id', true)::uuid
            OR ("companyId" IS NULL AND current_setting('app.current_company_id', true) IS NULL)
          )
          WITH CHECK (
            "companyId" = current_setting('app.current_company_id', true)::uuid
            OR ("companyId" IS NULL AND current_setting('app.current_company_id', true) IS NULL)
          )
        `);
      } else {
        await queryRunner.query(`
          CREATE POLICY "tenant_isolation_${table}" ON "${table}"
          USING ("companyId" = current_setting('app.current_company_id', true)::uuid)
          WITH CHECK ("companyId" = current_setting('app.current_company_id', true)::uuid)
        `);
      }
    }

    // A tabela "companies" não tem companyId (ela É o tenant), então não recebe RLS
    // por linha — o acesso a ela é controlado por papel de aplicação (master_admin
    // vê todas; manager só enxerga a própria, filtrado no código do módulo Companies).

    // ---------- Função de login (bypass controlado e estreito da RLS) ----------
    // RLS bloqueia SELECTs em "users" enquanto app.current_company_id não estiver
    // definido — o que é exatamente o caso durante o login, já que o tenant do
    // usuário ainda não é conhecido antes de encontrá-lo pelo e-mail. Em vez de
    // enfraquecer a RLS ou usar um role com BYPASSRLS geral, criamos uma função
    // SECURITY DEFINER estreita: ela roda com o privilégio de quem a criou (o role
    // administrador que executa as migrations, dono das tabelas) e devolve somente
    // os campos estritamente necessários para autenticar.
    await queryRunner.query(`
      CREATE FUNCTION auth_lookup_user_by_email(p_email varchar)
      RETURNS TABLE (
        id uuid,
        "companyId" uuid,
        "passwordHash" varchar,
        role user_role_enum,
        "isActive" boolean,
        name varchar
      )
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT u.id, u."companyId", u."passwordHash", u.role, u."isActive", u.name
        FROM users u
        WHERE u.email = p_email
        LIMIT 1;
      $$;
    `);

    // Concede execução ao role de runtime da aplicação, se ele já existir neste
    // ambiente (ver backend/docker/init-db/001-create-app-role.sql). Em bancos
    // gerenciados (RDS/DO), ajuste o nome do role conforme o provisionamento real.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
          EXECUTE 'GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(varchar) TO inventory_saas_app';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS auth_lookup_user_by_email(varchar)`);
    for (const table of ['users', 'products', 'losses']) {
      await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "losses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_company_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "companies"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "company_status_enum"`);
  }
}

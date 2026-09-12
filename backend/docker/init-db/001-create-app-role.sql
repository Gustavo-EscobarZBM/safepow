-- Executado automaticamente pelo container oficial do Postgres na primeira
-- inicialização do volume de dados (docker-entrypoint-initdb.d).
--
-- Por que este role existe: no PostgreSQL, o DONO de uma tabela ignora as
-- políticas de Row Level Security por padrão. O usuário definido em
-- POSTGRES_USER (que roda as migrations e é dono das tabelas) NÃO deve ser o
-- mesmo usado pelo backend em tempo de execução, ou a RLS da migration inicial
-- não protegeria nada de verdade. Este role separado, sem SUPERUSER e sem
-- BYPASSRLS, é quem a aplicação usa para servir requisições — é nele que a
-- política "tenant_isolation_*" (ver migration InitialSchema) realmente se aplica.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'inventory_saas_app') THEN
    CREATE ROLE inventory_saas_app LOGIN PASSWORD 'change-me-app-role-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE inventory_saas TO inventory_saas_app;
GRANT USAGE ON SCHEMA public TO inventory_saas_app;

-- As tabelas ainda não existem neste momento (este script roda antes das
-- migrations). ALTER DEFAULT PRIVILEGES garante que, quando as migrations
-- criarem as tabelas, os privilégios abaixo já se apliquem automaticamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inventory_saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO inventory_saas_app;

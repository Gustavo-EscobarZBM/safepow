import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tabela ⇒ [tipo de entidade, colunas ignoradas no diff (além de id/companyId/createdAt/updatedAt)]. */
const AUDITED_TABLES: Record<string, [string, string]> = {
  products: ['product', 'sourceColumnMapping'],
  loss_reasons: ['loss_reason', ''],
  loss_locations: ['loss_location', ''],
  losses: ['loss', ''],
  users: ['user', ''],
  companies: ['company', 'billingProviderCustomerId,currentPeriodEnd'],
  company_monthly_revenue: ['company_revenue', ''],
};

/**
 * Trigger genérico de auditoria (SP2, etapa 2.1 — decisão U4: trigger, não disciplina de serviço). Nenhum
 * escritor escapa (painel, app, importação, ERP futuro, SQL avulso). Grava via audit_insert (1700000015000).
 */
export class AuditTriggers1700000016000 implements MigrationInterface {
  name = 'AuditTriggers1700000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION audit_row_change() RETURNS trigger AS $$
      DECLARE
        v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
        v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
        v_row     jsonb := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
        v_ignored text[] := ARRAY['id', 'companyId', 'createdAt', 'updatedAt']
                            || COALESCE(string_to_array(NULLIF(TG_ARGV[1], ''), ','), ARRAY[]::text[]);
        v_changes jsonb := '[]'::jsonb;
        v_action  text;
        v_company uuid;
        v_label   text;
        v_key     text;
      BEGIN
        IF current_setting('app.audit_mode', true) = 'summary' THEN
          RETURN NULL;
        END IF;
        IF TG_TABLE_NAME = 'companies' THEN
          IF TG_OP = 'DELETE' THEN
            RETURN NULL; -- o log da empresa vai junto em cascata
          END IF;
          v_company := (v_row ->> 'id')::uuid;
        ELSE
          v_company := (v_row ->> 'companyId')::uuid;
        END IF;
        IF v_company IS NULL THEN
          RETURN NULL; -- master_admin (sem empresa)
        END IF;

        FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
          CONTINUE WHEN v_key = ANY (v_ignored);
          IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
            IF v_key = 'passwordHash' THEN
              v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'password', 'from', NULL, 'to', 'alterada'));
            ELSE
              v_changes := v_changes || jsonb_build_array(
                jsonb_build_object('field', v_key, 'from', v_old -> v_key, 'to', v_new -> v_key));
            END IF;
          END IF;
        END LOOP;

        IF TG_OP = 'INSERT' THEN
          v_action := 'create';
        ELSIF TG_OP = 'DELETE' THEN
          v_action := 'delete';
        ELSE
          IF jsonb_array_length(v_changes) = 0 THEN
            RETURN NULL;
          END IF;
          IF (v_old ->> 'isActive') = 'true' AND (v_new ->> 'isActive') = 'false' THEN
            v_action := 'archive';
          ELSIF (v_old ->> 'isActive') = 'false' AND (v_new ->> 'isActive') = 'true' THEN
            v_action := 'restore';
          ELSE
            v_action := 'update';
          END IF;
        END IF;

        v_label := CASE
          WHEN v_row ? 'name' THEN v_row ->> 'name'
          WHEN v_row ? 'year' THEN (v_row ->> 'year') || '/' || lpad(v_row ->> 'month', 2, '0')
        END;

        PERFORM audit_insert(v_company, TG_ARGV[0], (v_row ->> 'id')::uuid, v_label, v_action, v_changes, NULL);
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql SET search_path = public, pg_temp
    `);

    for (const [table, [entityType, ignored]] of Object.entries(AUDITED_TABLES)) {
      await queryRunner.query(`
        CREATE TRIGGER "trg_audit_${table}"
          AFTER INSERT OR UPDATE OR DELETE ON "${table}"
          FOR EACH ROW EXECUTE FUNCTION audit_row_change('${entityType}', '${ignored}')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of Object.keys(AUDITED_TABLES)) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_audit_${table}" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_row_change()`);
  }
}

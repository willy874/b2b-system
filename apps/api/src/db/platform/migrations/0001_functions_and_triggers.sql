-- 手寫 migration：平台 DB 的 updated_at（docs/adr/0020-physical-tenant-isolation.md D1）。
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tenants_set_updated_at ON tenants;
--> statement-breakpoint

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

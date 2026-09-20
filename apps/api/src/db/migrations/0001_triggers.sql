-- 手寫 migration：不變條件的 DB 層強制（docs/backend/02-database.md §3）

-- ── I7 系統角色保護 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_system_roles() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot delete system role %', OLD.slug;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.slug <> OLD.slug THEN
      RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot rename slug of system role %', OLD.slug;
    END IF;
    IF NEW.is_system <> OLD.is_system THEN
      RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot change is_system flag';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS roles_protect_system ON roles;
--> statement-breakpoint

CREATE TRIGGER roles_protect_system
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION protect_system_roles();
--> statement-breakpoint

-- ── I12 稽核不可變（append-only）──────────────────────────────
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit_logs is append-only';
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
--> statement-breakpoint

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
--> statement-breakpoint

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint

-- ── updated_at 自動更新 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
--> statement-breakpoint

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

DROP TRIGGER IF EXISTS roles_set_updated_at ON roles;
--> statement-breakpoint

CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 手寫 migration：DB 層的不變條件、updated_at、稽核冷熱分層（docs/architecture/backend/02-database.md §3）。
-- 2026-09-29 重新建立基準點（docs/adr/0020-physical-tenant-isolation.md D20）時，由舊的 0001、0003、0005、0006、0014 合併而來。

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
--> statement-breakpoint

-- ── 其他表的 updated_at ───────────────────────────────────────
DROP TRIGGER IF EXISTS approval_requests_set_updated_at ON approval_requests;
--> statement-breakpoint
CREATE TRIGGER approval_requests_set_updated_at BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS files_set_updated_at ON files;
--> statement-breakpoint
CREATE TRIGGER files_set_updated_at BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ══ 稽核日誌冷熱分層（docs/architecture/backend/06-audit-log.md §8、02-database.md §3.2）══
-- ── 冷表壓縮 ───────────────────────────────────────────────────
-- 冷資料讀得少、存得久：jsonb 改用 lz4（比預設 pglz 壓得快、解得快），只影響之後寫入的值
ALTER TABLE audit_logs_archive ALTER COLUMN changes SET COMPRESSION lz4;
--> statement-breakpoint
ALTER TABLE audit_logs_archive ALTER COLUMN metadata SET COMPRESSION lz4;
--> statement-breakpoint

-- ── I12 冷表同樣 append-only ───────────────────────────────────
DROP TRIGGER IF EXISTS audit_logs_archive_no_update ON audit_logs_archive;
--> statement-breakpoint

CREATE TRIGGER audit_logs_archive_no_update BEFORE UPDATE ON audit_logs_archive
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_archive_no_delete ON audit_logs_archive;
--> statement-breakpoint

CREATE TRIGGER audit_logs_archive_no_delete BEFORE DELETE ON audit_logs_archive
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint

-- ── I12 熱表只允許「已完整搬進冷表」的列被刪除 ─────────────────
-- 取代上面無條件的 audit_logs_no_delete：搬移需要刪熱表，但任何一筆被刪的紀錄
-- 都必須在冷表有一模一樣的副本，稽核內容因此不會遺失或被竄改。
CREATE OR REPLACE FUNCTION audit_logs_guard_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM audit_logs_archive a
    WHERE a.id = OLD.id
      AND (a.occurred_at, a.actor_id, a.actor_email, a.action, a.resource_type, a.resource_id,
           a.resource_name, a.result, a.error_code, a.changes, a.metadata)
          IS NOT DISTINCT FROM
          (OLD.occurred_at, OLD.actor_id, OLD.actor_email, OLD.action, OLD.resource_type,
           OLD.resource_id, OLD.resource_name, OLD.result, OLD.error_code, OLD.changes, OLD.metadata)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit_logs row % must be archived before delete', OLD.id;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
--> statement-breakpoint

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard_delete();
--> statement-breakpoint

-- ── 熱 → 冷搬移 ────────────────────────────────────────────────
-- 一次搬一批（最舊的先搬），回傳搬了幾筆；呼叫端重複呼叫到回傳值 < batch_size 為止。
-- 每次呼叫是一個短交易，不會長時間鎖住熱表；SKIP LOCKED 讓兩個排程重疊時不互搶。
CREATE OR REPLACE FUNCTION archive_audit_logs(cutoff timestamptz, batch_size integer)
RETURNS integer AS $$
DECLARE
  ids bigint[];
  moved integer;
BEGIN
  SELECT array_agg(id) INTO ids FROM (
    SELECT id FROM audit_logs
    WHERE occurred_at < cutoff
    ORDER BY occurred_at, id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ) batch;

  IF ids IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO audit_logs_archive (
    id, occurred_at, actor_id, actor_email, action, resource_type, resource_id,
    resource_name, result, error_code, changes, metadata
  )
  SELECT
    id, occurred_at, actor_id, actor_email, action, resource_type, resource_id,
    resource_name, result, error_code, changes, metadata
  FROM audit_logs
  WHERE id = ANY (ids)
  ORDER BY occurred_at, id;

  DELETE FROM audit_logs WHERE id = ANY (ids);
  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN moved;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ── 封存函式以擁有者權限執行（docs/adr/0016-background-jobs.md D8）──
-- 以函式擁有者（擁有資料表、跑 migration 的 role）的權限執行：應用程式的 role 不需要 audit_logs 的
-- DELETE，只能透過這個函式做「熱 → 冷搬移」；熱表的刪除 trigger 仍要求冷表有完全相同的副本
-- （上面的 audit_logs_guard_delete），函式也做不了別的事。
--
-- 固定 search_path：SECURITY DEFINER 函式若沿用呼叫端的 search_path，呼叫端可以建立同名的
-- 表或函式來劫持它。
--
-- EXECUTE 維持 PostgreSQL 的預設（PUBLIC）：role 的名稱依部署而定，migration 無法指名。
-- 把應用程式與維運拆成不同 role 的部署，可自行 REVOKE ... FROM PUBLIC 後只 GRANT 給應用程式的 role。
-- 呼叫端能決定的只有 cutoff 與批次大小；搬到冷表的紀錄仍可查詢（06-audit-log.md §7.2），不會遺失。
ALTER FUNCTION archive_audit_logs(timestamptz, integer)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

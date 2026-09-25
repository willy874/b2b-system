-- 手寫 migration：稽核日誌冷熱分層（docs/architecture/backend/06-audit-log.md §8、02-database.md §3.2）

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
-- 取代 0001 的無條件 audit_logs_no_delete：搬移需要刪熱表，但任何一筆被刪的紀錄
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

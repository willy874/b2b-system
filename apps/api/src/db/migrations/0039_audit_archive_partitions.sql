-- 稽核冷表改成按月 RANGE 分區（docs/architecture/backend/06-audit-log.md §8、§10）：保留期限以 DROP 整個月份分區執行，
-- 瞬間完成、不產生 bloat，也不必拿掉 append-only 的 trigger。熱表不變。
-- 在同一個交易內完成：冷表在這段時間被鎖住，只影響查詢早於熱表保留天數的稽核。大型租戶（百萬列以上）先在備份上量時間。

-- ── 1. 舊表改名（索引一起改名，新表才能用原本的名稱）──────────────
ALTER TABLE "audit_logs_archive" RENAME TO "audit_logs_archive_legacy";--> statement-breakpoint
ALTER INDEX "audit_logs_archive_pkey" RENAME TO "audit_logs_archive_legacy_pkey";--> statement-breakpoint
ALTER INDEX "audit_logs_archive_occurred_idx" RENAME TO "audit_logs_archive_legacy_occurred_idx";--> statement-breakpoint
ALTER INDEX "audit_logs_archive_actor_idx" RENAME TO "audit_logs_archive_legacy_actor_idx";--> statement-breakpoint
ALTER INDEX "audit_logs_archive_resource_idx" RENAME TO "audit_logs_archive_legacy_resource_idx";--> statement-breakpoint
ALTER INDEX "audit_logs_archive_action_idx" RENAME TO "audit_logs_archive_legacy_action_idx";--> statement-breakpoint

-- ── 2. 分區表（欄位順序與熱表相同：archive_audit_logs 與冷熱 UNION ALL 依賴它）──
-- 分區表的唯一鍵必須包含分區鍵：主鍵是 (id, occurred_at)。不建 default 分區：找不到分區時插入失敗、整批 rollback，
-- 不會默默丟資料，之後建立新分區也不必掃描 default。
CREATE TABLE "audit_logs_archive" (
	"id" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"resource_name" text,
	"result" "audit_result" NOT NULL,
	"error_code" text,
	"changes" jsonb,
	"metadata" jsonb,
	CONSTRAINT "audit_logs_archive_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_archive_occurred_idx" ON "audit_logs_archive" USING btree ("occurred_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_actor_idx" ON "audit_logs_archive" USING btree ("actor_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_resource_idx" ON "audit_logs_archive" USING btree ("resource_type","resource_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_action_idx" ON "audit_logs_archive" USING btree ("action" text_pattern_ops,"occurred_at" DESC NULLS FIRST);--> statement-breakpoint

-- ── 3. 建立月份分區：涵蓋 [from_ts, to_ts] 的每個月（UTC），已存在的略過；回傳新建的數量 ──
-- 分區名稱 audit_logs_archive_pYYYYMM（drop_expired_audit_archive_partitions 以它算出上界）。
-- jsonb 改用 lz4（冷資料讀得少、存得久），在每個分區上設定。
CREATE OR REPLACE FUNCTION ensure_audit_archive_partitions(from_ts timestamptz, to_ts timestamptz)
RETURNS integer AS $$
DECLARE
  month_start timestamptz;
  last_month timestamptz;
  partition_name text;
  created integer := 0;
BEGIN
  IF from_ts IS NULL OR to_ts IS NULL THEN
    RETURN 0;
  END IF;
  month_start := date_trunc('month', from_ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  last_month := date_trunc('month', to_ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  WHILE month_start <= last_month LOOP
    partition_name := 'audit_logs_archive_p' || to_char(month_start AT TIME ZONE 'UTC', 'YYYYMM');
    IF to_regclass(partition_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_logs_archive FOR VALUES FROM (%L) TO (%L)',
        partition_name, month_start, month_start + interval '1 month'
      );
      EXECUTE format('ALTER TABLE %I ALTER COLUMN changes SET COMPRESSION lz4', partition_name);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN metadata SET COMPRESSION lz4', partition_name);
      created := created + 1;
    END IF;
    month_start := month_start + interval '1 month';
  END LOOP;
  RETURN created;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
ALTER FUNCTION ensure_audit_archive_partitions(timestamptz, timestamptz)
  SECURITY DEFINER
  SET search_path = public, pg_temp;--> statement-breakpoint

-- ── 4. 搬資料：舊表涵蓋的月份 ＋ 這個月與下個月 ──────────────────
SELECT ensure_audit_archive_partitions(
  coalesce((SELECT min("occurred_at") FROM "audit_logs_archive_legacy"), now()),
  now() + interval '1 month'
);--> statement-breakpoint
INSERT INTO "audit_logs_archive" SELECT * FROM "audit_logs_archive_legacy";--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT count(*) FROM "audit_logs_archive") <> (SELECT count(*) FROM "audit_logs_archive_legacy") THEN
    RAISE EXCEPTION '稽核冷表的分區搬移筆數不符';
  END IF;
END $$;--> statement-breakpoint
-- append-only 的 trigger 是 row trigger，不擋 DROP（舊表的 trigger 隨表刪除）
DROP TABLE "audit_logs_archive_legacy";--> statement-breakpoint

-- ── 5. append-only（I12）：row trigger 建在分區表上，套用到每個分區 ──
CREATE TRIGGER audit_logs_archive_no_update BEFORE UPDATE ON audit_logs_archive
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();--> statement-breakpoint
CREATE TRIGGER audit_logs_archive_no_delete BEFORE DELETE ON audit_logs_archive
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();--> statement-breakpoint

-- ── 6. 熱表的刪除保護：比對時帶上 occurred_at，只探查那一個分區 ──────
CREATE OR REPLACE FUNCTION audit_logs_guard_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM audit_logs_archive a
    WHERE a.id = OLD.id
      AND a.occurred_at = OLD.occurred_at
      AND (a.actor_id, a.actor_email, a.action, a.resource_type, a.resource_id,
           a.resource_name, a.result, a.error_code, a.changes, a.metadata)
          IS NOT DISTINCT FROM
          (OLD.actor_id, OLD.actor_email, OLD.action, OLD.resource_type,
           OLD.resource_id, OLD.resource_name, OLD.result, OLD.error_code, OLD.changes, OLD.metadata)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit_logs row % must be archived before delete', OLD.id;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint

-- ── 7. 熱 → 冷搬移：插入前先建好這批資料涵蓋的月份分區 ────────────
-- CREATE OR REPLACE 不保留 SECURITY DEFINER，下面重新設定（同 0001）。
CREATE OR REPLACE FUNCTION archive_audit_logs(cutoff timestamptz, batch_size integer)
RETURNS integer AS $$
DECLARE
  ids bigint[];
  oldest timestamptz;
  newest timestamptz;
  moved integer;
BEGIN
  SELECT array_agg(id), min(occurred_at), max(occurred_at) INTO ids, oldest, newest FROM (
    SELECT id, occurred_at FROM audit_logs
    WHERE occurred_at < cutoff
    ORDER BY occurred_at, id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ) batch;

  IF ids IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM ensure_audit_archive_partitions(oldest, newest);

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
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
ALTER FUNCTION archive_audit_logs(timestamptz, integer)
  SECURITY DEFINER
  SET search_path = public, pg_temp;--> statement-breakpoint

-- ── 8. 保留期限：只以 DROP 整個月份分區刪除 ──────────────────────
-- 只刪「上界 ≤ cutoff」的分區（整個月都早於 cutoff）；cutoff 晚於「現在 − 365 天」一律拒絕：
-- 應用程式的 role 即使被濫用也刪不到一年內的資料。回傳刪掉的分區與列數（呼叫端寫稽核 auditLog.purge）。
-- 應用程式的 role 不是擁有者，不能自己 DROP／DETACH 分區，只能透過這個函式。
CREATE OR REPLACE FUNCTION drop_expired_audit_archive_partitions(cutoff date)
RETURNS TABLE (partition_name text, row_count bigint) AS $$
DECLARE
  part record;
  upper_bound date;
  rows_in_partition bigint;
BEGIN
  IF cutoff > (now() AT TIME ZONE 'UTC')::date - 365 THEN
    RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit archive retention must be at least 365 days (cutoff %)', cutoff;
  END IF;
  FOR part IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs_archive' AND c.relname ~ '^audit_logs_archive_p[0-9]{6}$'
    ORDER BY c.relname
  LOOP
    upper_bound := (to_date(substring(part.relname FROM '[0-9]{6}$'), 'YYYYMM') + interval '1 month')::date;
    IF upper_bound <= cutoff THEN
      EXECUTE format('SELECT count(*) FROM %I', part.relname) INTO rows_in_partition;
      EXECUTE format('DROP TABLE %I', part.relname);
      partition_name := part.relname;
      row_count := rows_in_partition;
      RETURN NEXT;
    END IF;
  END LOOP;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
ALTER FUNCTION drop_expired_audit_archive_partitions(date)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

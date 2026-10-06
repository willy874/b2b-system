-- 檔案已用量的計數（docs/architecture/05-tenancy.md §13.3 D8、docs/architecture/backend/09-file.md §5.0）。
-- 表由 drizzle-kit 產生；初始列為手寫：以既有檔案（含上傳中與回收桶裡的）的 SUM(size) 回填。
-- 之後由 FileRepository 在登記、完成、永久刪除的同一個交易內增減，file.maintenance 每天對帳一次。
-- reconciled_at 留 null：migration 之後、新版 api 上線之前，舊版仍可能登記上傳（不更新計數），
-- 新版的第一輪 file.maintenance 就會對帳，不必等一天。

CREATE TABLE "file_storage_usage" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reconciled_at" timestamp with time zone,
	CONSTRAINT "file_storage_usage_single_row" CHECK ("file_storage_usage"."id")
);
--> statement-breakpoint

INSERT INTO "file_storage_usage" ("id", "used_bytes")
SELECT true, coalesce(sum("size"), 0) FROM "files"
ON CONFLICT DO NOTHING;

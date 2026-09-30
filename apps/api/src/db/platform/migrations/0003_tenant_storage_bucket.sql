-- 每個租戶一個 bucket（docs/adr/0020-physical-tenant-isolation.md D16）。drizzle-kit 產生後手動調整：
-- 既有的預設租戶（第 2 步登記）的檔案在原本共用的 bucket（FILE_STORAGE_BUCKET 的預設值 b2b-system），沿用它、不必搬物件；
-- 其他已登記的租戶（只可能是手動登記的）給自己的 bucket。之後的租戶由 db:migrate 或佈建指定。
ALTER TABLE "tenants" ADD COLUMN "storage_bucket" text;--> statement-breakpoint
UPDATE "tenants"
SET "storage_bucket" = CASE WHEN "code" = 'default' THEN 'b2b-system' ELSE 'b2b-' || lower("code") END
WHERE "storage_bucket" IS NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "storage_bucket" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_storage_bucket_key" ON "tenants" USING btree ("storage_bucket");

-- 檔名部分比對的 GIN 索引需要 pg_trgm（PG 13 起為 trusted extension，資料庫擁有者即可建立）
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "upload_id" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "has_thumbnail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "files_status_name_idx" ON "files" USING btree ("status","name","id") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_status_size_idx" ON "files" USING btree ("status","size","id") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_status_content_type_idx" ON "files" USING btree ("status","content_type") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_name_trgm_idx" ON "files" USING gin ("name" gin_trgm_ops) WHERE "files"."deleted_at" IS NULL;
CREATE TYPE "public"."file_variant_status" AS ENUM('none', 'pending', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "variant_status" "file_variant_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "image_height" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "variant_format" text;--> statement-breakpoint
CREATE INDEX "files_variant_pending_idx" ON "files" USING btree ("uploaded_at") WHERE "files"."variant_status" = 'pending' AND "files"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_variant_ready_described" CHECK ("files"."variant_status" <> 'ready' OR ("files"."image_width" IS NOT NULL AND "files"."image_height" IS NOT NULL AND "files"."variant_format" IS NOT NULL));--> statement-breakpoint
-- 既有的圖片排入補產生：維護排程（FileMaintenanceService）會把 pending 的變體補齊。
-- 型別清單與 file.constants.ts 的 IMAGE_VARIANT_SOURCE_TYPES 相同。
UPDATE "files" SET "variant_status" = 'pending'
WHERE "status" = 'ready' AND "deleted_at" IS NULL
  AND "content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff');

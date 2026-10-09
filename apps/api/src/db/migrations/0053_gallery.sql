-- 圖片庫（docs/architecture/backend/26-gallery.md §3）。純加法：新的 enum、三張新表與索引。
-- sort_at 是產生欄位 coalesce(taken_at, created_at)：時間軸的 keyset 與預設排序都用它。

CREATE TYPE "public"."gallery_item_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "gallery_album_items" (
	"album_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_album_items_album_id_item_id_pk" PRIMARY KEY("album_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "gallery_albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cover_item_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "gallery_item_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"display_rotation" integer DEFAULT 0 NOT NULL,
	"has_original" boolean DEFAULT false NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"variant_rev" integer,
	"variants" jsonb,
	"variant_format" text,
	"dominant_color" text,
	"placeholder" text,
	"taken_at" timestamp with time zone,
	"sort_at" timestamp with time zone GENERATED ALWAYS AS (coalesce(taken_at, created_at)) STORED NOT NULL,
	"exif" jsonb,
	"location_stripped" boolean DEFAULT false NOT NULL,
	"content_hash" text,
	"source" text NOT NULL,
	"source_ref_id" text,
	"source_name" text,
	"version" integer DEFAULT 1 NOT NULL,
	"queued_at" timestamp with time zone,
	"stale_revs_purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "gallery_items_size_non_negative" CHECK ("gallery_items"."size" >= 0),
	CONSTRAINT "gallery_items_display_rotation" CHECK ("gallery_items"."display_rotation" IN (0, 90, 180, 270)),
	CONSTRAINT "gallery_items_ready_described" CHECK ("gallery_items"."status" <> 'ready' OR ("gallery_items"."has_original" AND "gallery_items"."width" IS NOT NULL AND "gallery_items"."height" IS NOT NULL AND "gallery_items"."variant_rev" IS NOT NULL AND "gallery_items"."variants" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "gallery_album_items" ADD CONSTRAINT "gallery_album_items_album_id_gallery_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."gallery_albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_album_items" ADD CONSTRAINT "gallery_album_items_item_id_gallery_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."gallery_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_cover_item_id_gallery_items_id_fk" FOREIGN KEY ("cover_item_id") REFERENCES "public"."gallery_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gallery_album_items_item_idx" ON "gallery_album_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_albums_name_key" ON "gallery_albums" USING btree (lower("name")) WHERE "gallery_albums"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gallery_albums_deleted_idx" ON "gallery_albums" USING btree ("deleted_at") WHERE "gallery_albums"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gallery_items_sort_idx" ON "gallery_items" USING btree ("sort_at","id") WHERE "gallery_items"."deleted_at" IS NULL AND "gallery_items"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "gallery_items_created_idx" ON "gallery_items" USING btree ("created_at","id") WHERE "gallery_items"."deleted_at" IS NULL AND "gallery_items"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "gallery_items_title_idx" ON "gallery_items" USING btree ("title","id") WHERE "gallery_items"."deleted_at" IS NULL AND "gallery_items"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "gallery_items_text_trgm_idx" ON "gallery_items" USING gin (("title" || ' ' || coalesce("description", '')) gin_trgm_ops) WHERE "gallery_items"."deleted_at" IS NULL AND "gallery_items"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "gallery_items_hash_idx" ON "gallery_items" USING btree ("content_hash") WHERE "gallery_items"."deleted_at" IS NULL AND "gallery_items"."content_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gallery_items_source_idx" ON "gallery_items" USING btree ("source","source_ref_id") WHERE "gallery_items"."deleted_at" IS NULL AND "gallery_items"."source_ref_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gallery_items_uploads_idx" ON "gallery_items" USING btree ("created_by","status") WHERE "gallery_items"."status" <> 'ready';--> statement-breakpoint
CREATE INDEX "gallery_items_queued_idx" ON "gallery_items" USING btree ("queued_at") WHERE "gallery_items"."status" IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "gallery_items_stale_revs_idx" ON "gallery_items" USING btree ("stale_revs_purge_after") WHERE "gallery_items"."stale_revs_purge_after" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gallery_items_deleted_idx" ON "gallery_items" USING btree ("deleted_at") WHERE "gallery_items"."deleted_at" IS NOT NULL;
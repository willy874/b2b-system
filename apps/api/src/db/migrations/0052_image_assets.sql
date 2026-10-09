-- 圖片資產（docs/architecture/backend/25-image.md §15.1）與使用者的頭像。純加法：新表、新欄位、新索引。
-- users.avatar_image_id 不設外鍵：image_assets.created_by 參照 users，反過來再參照會讓 schema 循環。

CREATE TYPE "public"."image_asset_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "image_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage" text NOT NULL,
	"status" "image_asset_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"source" text NOT NULL,
	"source_ref_id" text,
	"source_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"has_alpha" boolean,
	"master_format" text,
	"content_hash" text,
	"crop" jsonb,
	"rev" integer DEFAULT 1 NOT NULL,
	"variant_rev" integer,
	"variants" jsonb,
	"queued_at" timestamp with time zone,
	"stale_revs_purge_after" timestamp with time zone,
	"owner_type" text,
	"owner_id" uuid,
	"detached_at" timestamp with time zone,
	"hidden_from_recent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_assets_size_non_negative" CHECK ("image_assets"."size" >= 0),
	CONSTRAINT "image_assets_ready_described" CHECK ("image_assets"."status" <> 'ready' OR ("image_assets"."width" IS NOT NULL AND "image_assets"."height" IS NOT NULL AND "image_assets"."master_format" IS NOT NULL AND "image_assets"."variant_rev" IS NOT NULL AND "image_assets"."variants" IS NOT NULL)),
	CONSTRAINT "image_assets_owner_pair" CHECK (("image_assets"."owner_type" IS NULL) = ("image_assets"."owner_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_image_id" uuid;--> statement-breakpoint
ALTER TABLE "image_assets" ADD CONSTRAINT "image_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_assets_recent_idx" ON "image_assets" USING btree ("created_by","created_at") WHERE "image_assets"."status" = 'ready' AND "image_assets"."hidden_from_recent_at" IS NULL;--> statement-breakpoint
CREATE INDEX "image_assets_owner_idx" ON "image_assets" USING btree ("owner_type","owner_id") WHERE "image_assets"."owner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "image_assets_unclaimed_idx" ON "image_assets" USING btree ("created_at") WHERE "image_assets"."owner_id" IS NULL;--> statement-breakpoint
CREATE INDEX "image_assets_detached_idx" ON "image_assets" USING btree ("detached_at") WHERE "image_assets"."detached_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "image_assets_queued_idx" ON "image_assets" USING btree ("queued_at") WHERE "image_assets"."queued_at" IS NOT NULL AND "image_assets"."status" <> 'failed';--> statement-breakpoint
CREATE INDEX "image_assets_stale_revs_idx" ON "image_assets" USING btree ("stale_revs_purge_after") WHERE "image_assets"."stale_revs_purge_after" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "image_assets_pending_idx" ON "image_assets" USING btree ("created_by") WHERE "image_assets"."status" = 'pending';
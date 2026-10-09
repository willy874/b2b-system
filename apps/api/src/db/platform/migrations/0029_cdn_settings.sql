CREATE TYPE "public"."cdn_state" AS ENUM('on', 'off');--> statement-breakpoint
CREATE TABLE "cdn_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"state" "cdn_state",
	"resources" text[],
	"url_ttl_cap" integer,
	"purge_on_delete" boolean,
	"purge_batch_size" integer,
	"state_changed_at" timestamp with time zone,
	"state_changed_by" uuid,
	"last_check_at" timestamp with time zone,
	"last_check" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cdn_settings_singleton" CHECK ("cdn_settings"."id" = 'default'),
	CONSTRAINT "cdn_settings_url_ttl_cap_check" CHECK ("cdn_settings"."url_ttl_cap" BETWEEN 300 AND 86400),
	CONSTRAINT "cdn_settings_purge_batch_size_check" CHECK ("cdn_settings"."purge_batch_size" BETWEEN 1 AND 1000)
);

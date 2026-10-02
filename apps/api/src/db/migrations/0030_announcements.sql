CREATE TABLE "announcement_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient_count" integer,
	"details" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "announcement_dispatches_status_check" CHECK ("announcement_dispatches"."status" IN ('pending', 'sending', 'sent', 'failed', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" jsonb NOT NULL,
	"trigger" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"next_run_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "announcements_status_check" CHECK ("announcements"."status" IN ('draft', 'scheduled', 'paused', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "announcement_dispatches" ADD CONSTRAINT "announcement_dispatches_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dispatches" ADD CONSTRAINT "announcement_dispatches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dispatches" ADD CONSTRAINT "announcement_dispatches_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_dispatches_once_key" ON "announcement_dispatches" USING btree ("announcement_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "announcement_dispatches_announcement_idx" ON "announcement_dispatches" USING btree ("announcement_id","created_at","id");--> statement-breakpoint
CREATE INDEX "announcements_created_idx" ON "announcements" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "announcements_next_run_idx" ON "announcements" USING btree ("next_run_at") WHERE "announcements"."status" = 'scheduled' AND "announcements"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_source_recipient_key" ON "notifications" USING btree ("source_id","recipient_id") WHERE "notifications"."source_id" IS NOT NULL;
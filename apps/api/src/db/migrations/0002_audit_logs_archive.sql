CREATE TABLE "audit_logs_archive" (
	"id" bigint PRIMARY KEY NOT NULL,
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
	"metadata" jsonb
);
--> statement-breakpoint
DROP INDEX "audit_logs_occurred_idx";--> statement-breakpoint
DROP INDEX "audit_logs_actor_idx";--> statement-breakpoint
DROP INDEX "audit_logs_resource_idx";--> statement-breakpoint
DROP INDEX "audit_logs_action_idx";--> statement-breakpoint
CREATE INDEX "audit_logs_archive_occurred_idx" ON "audit_logs_archive" USING btree ("occurred_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_actor_idx" ON "audit_logs_archive" USING btree ("actor_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_resource_idx" ON "audit_logs_archive" USING btree ("resource_type","resource_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_idx" ON "audit_logs" USING btree ("occurred_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action" text_pattern_ops,"occurred_at" DESC NULLS FIRST);
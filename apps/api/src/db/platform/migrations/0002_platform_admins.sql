CREATE TYPE "public"."platform_admin_status" AS ENUM('active', 'inactive', 'locked');--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"status" "platform_admin_status" DEFAULT 'active' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"result" text NOT NULL,
	"error_code" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "platform_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"client_id" text,
	"idp_session_uid" text,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_refresh_tokens" ADD CONSTRAINT "platform_refresh_tokens_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins" USING btree ("email") WHERE "platform_admins"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "platform_audit_logs_occurred_idx" ON "platform_audit_logs" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "platform_refresh_tokens_hash_key" ON "platform_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "platform_refresh_tokens_family_idx" ON "platform_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "platform_refresh_tokens_idp_session_idx" ON "platform_refresh_tokens" USING btree ("idp_session_uid") WHERE "platform_refresh_tokens"."idp_session_uid" IS NOT NULL AND "platform_refresh_tokens"."revoked_at" IS NULL;--> statement-breakpoint
-- 手寫：updated_at（函式在 0001 建立）、稽核 append-only
DROP TRIGGER IF EXISTS platform_admins_set_updated_at ON platform_admins;--> statement-breakpoint
CREATE TRIGGER platform_admins_set_updated_at BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform_audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: platform_audit_logs is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS platform_audit_logs_immutable ON platform_audit_logs;--> statement-breakpoint
CREATE TRIGGER platform_audit_logs_immutable BEFORE UPDATE OR DELETE ON platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION platform_audit_logs_append_only();

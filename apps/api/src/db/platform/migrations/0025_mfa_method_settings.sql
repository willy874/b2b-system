CREATE TABLE "mfa_channel_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"code_hash" text NOT NULL,
	"realm" text NOT NULL,
	"tenant_id" uuid,
	"account_id" uuid NOT NULL,
	"recipient_encrypted" text,
	"recipient_name" text,
	"linked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_channel_links_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "mfa_channel_links_realm_check" CHECK ("mfa_channel_links"."realm" IN ('tenant', 'platform'))
);
--> statement-breakpoint
CREATE TABLE "mfa_method_settings" (
	"method" text PRIMARY KEY NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_encrypted" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mfa_channel_links_expires_at_idx" ON "mfa_channel_links" USING btree ("expires_at");
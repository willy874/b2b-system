CREATE TABLE "platform_admin_mfa_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"factor_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"interaction_uid" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resend_after" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"method" text NOT NULL,
	"label" text,
	"status" text NOT NULL,
	"secret_encrypted" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_used_counter" bigint,
	"last_used_at" timestamp with time zone,
	"interaction_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admin_mfa_factors_status_check" CHECK ("platform_admin_mfa_factors"."status" IN ('pending', 'active'))
);
--> statement-breakpoint
CREATE TABLE "platform_admin_mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "mfa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_admin_mfa_challenges" ADD CONSTRAINT "platform_admin_mfa_challenges_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_mfa_challenges" ADD CONSTRAINT "platform_admin_mfa_challenges_factor_id_platform_admin_mfa_factors_id_fk" FOREIGN KEY ("factor_id") REFERENCES "public"."platform_admin_mfa_factors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_mfa_factors" ADD CONSTRAINT "platform_admin_mfa_factors_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_mfa_recovery_codes" ADD CONSTRAINT "platform_admin_mfa_recovery_codes_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_admin_mfa_challenges_factor_idx" ON "platform_admin_mfa_challenges" USING btree ("factor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_admin_mfa_challenges_expires_idx" ON "platform_admin_mfa_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "platform_admin_mfa_factors_admin_idx" ON "platform_admin_mfa_factors" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "platform_admin_mfa_factors_pending_idx" ON "platform_admin_mfa_factors" USING btree ("created_at") WHERE "platform_admin_mfa_factors"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admin_mfa_recovery_codes_admin_hash_key" ON "platform_admin_mfa_recovery_codes" USING btree ("admin_id","code_hash");
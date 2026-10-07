CREATE TABLE "mfa_method_overrides" (
	"method" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_method_overrides_state_check" CHECK ("mfa_method_overrides"."state" IN ('on', 'off'))
);
--> statement-breakpoint
CREATE TABLE "mfa_method_stats" (
	"method" text PRIMARY KEY NOT NULL,
	"tenant_factors" integer NOT NULL,
	"tenants" integer NOT NULL,
	"platform_factors" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "mfa_methods" jsonb DEFAULT '{}'::jsonb NOT NULL;
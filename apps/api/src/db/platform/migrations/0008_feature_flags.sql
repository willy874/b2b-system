CREATE TABLE "feature_flag_overrides" (
	"key" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_overrides_state_check" CHECK ("feature_flag_overrides"."state" IN ('on', 'off'))
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "flags" jsonb DEFAULT '{}'::jsonb NOT NULL;
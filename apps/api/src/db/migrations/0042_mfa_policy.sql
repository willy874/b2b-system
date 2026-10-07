CREATE TABLE "mfa_policy" (
	"key" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"require_all" boolean DEFAULT false NOT NULL,
	"required_role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"allowed_methods" text[],
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "mfa_policy_singleton" CHECK ("mfa_policy"."key" = 'default')
);

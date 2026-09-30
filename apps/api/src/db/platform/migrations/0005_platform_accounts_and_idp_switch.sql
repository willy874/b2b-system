ALTER TYPE "public"."platform_admin_status" ADD VALUE 'pending';--> statement-breakpoint
CREATE TABLE "platform_auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "allow_external_idp" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_auth_tokens" ADD CONSTRAINT "platform_auth_tokens_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_auth_tokens_hash_key" ON "platform_auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "platform_auth_tokens_admin_purpose_idx" ON "platform_auth_tokens" USING btree ("admin_id","purpose") WHERE "platform_auth_tokens"."used_at" IS NULL;
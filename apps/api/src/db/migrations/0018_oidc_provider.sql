CREATE TABLE "oidc_payloads" (
	"type" text NOT NULL,
	"id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"uid" text,
	"user_code" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_payloads_type_id_pk" PRIMARY KEY("type","id")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "idp_session_uid" text;--> statement-breakpoint
CREATE INDEX "oidc_payloads_grant_idx" ON "oidc_payloads" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oidc_payloads_uid_idx" ON "oidc_payloads" USING btree ("type","uid");--> statement-breakpoint
CREATE INDEX "oidc_payloads_expires_idx" ON "oidc_payloads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_idp_session_idx" ON "refresh_tokens" USING btree ("idp_session_uid") WHERE "refresh_tokens"."idp_session_uid" IS NOT NULL AND "refresh_tokens"."revoked_at" IS NULL;
-- 外部 IdP 加上協定（OIDC、SAML 2.0）、OIDC 範本與協定自己的設定（docs/architecture/04-sso.md §3.3、§12.6）：純加法。
-- 既有的列都是 OIDC（預設值）；SAML 沒有 client，所以 client 兩欄改成可為 null，由 CHECK 保證 OIDC 一定有。
-- 通行金鑰登入以憑證 id 找 WebAuthn 的因子（§3.6）。
ALTER TABLE "identity_providers" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_providers" ALTER COLUMN "client_secret_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "protocol" text DEFAULT 'oidc' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "preset" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "mfa_factors_credential_idx" ON "mfa_factors" USING btree (("config" ->> 'credentialId')) WHERE "mfa_factors"."method" = 'webauthn';--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_protocol_check" CHECK ("identity_providers"."protocol" IN ('oidc', 'saml'));--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_preset_check" CHECK ("identity_providers"."preset" IN ('generic', 'google', 'microsoft', 'okta', 'keycloak'));--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_oidc_client_check" CHECK ("identity_providers"."protocol" <> 'oidc' OR ("identity_providers"."client_id" IS NOT NULL AND "identity_providers"."client_secret_encrypted" IS NOT NULL));
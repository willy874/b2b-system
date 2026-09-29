CREATE TYPE "public"."unmatched_account_policy" AS ENUM('reject', 'auto_create');--> statement-breakpoint
CREATE TABLE "identity_provider_domains" (
	"domain" "citext" PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"sso_only" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"scopes" text DEFAULT 'openid email profile' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"unmatched_policy" "unmatched_account_policy" DEFAULT 'reject' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"email" "citext",
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "identity_provider_domains" ADD CONSTRAINT "identity_provider_domains_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_provider_domains_provider_idx" ON "identity_provider_domains" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_providers_name_key" ON "identity_providers" USING btree ("name") WHERE "identity_providers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
-- 外部 IdP 連線的權限鍵（docs/rbac/02-permission-catalog.md §2.11）。
-- seed 只在角色「新建立」時寫入權限（rbac/05-seed-and-bootstrap.md §4.2），既有環境的系統角色由這裡補上。
INSERT INTO permissions (key, resource, action, name_i18n_key, sort_order, scope) VALUES
  ('identityProvider:create', 'identityProvider', 'create', 'permission.identityProvider.create', 1100, 'platform'),
  ('identityProvider:read', 'identityProvider', 'read', 'permission.identityProvider.read', 1101, 'platform'),
  ('identityProvider:update', 'identityProvider', 'update', 'permission.identityProvider.update', 1102, 'platform'),
  ('identityProvider:delete', 'identityProvider', 'delete', 'permission.identityProvider.delete', 1103, 'platform')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key LIKE 'identityProvider:%'
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'identityProvider:read'
WHERE r.slug = 'auditor' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

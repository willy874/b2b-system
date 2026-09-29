-- 檔名部分比對的 GIN 索引（files_name_trgm_idx）需要 pg_trgm（PG 13 起為 trusted extension，資料庫擁有者即可建立）
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."auth_token_purpose" AS ENUM('activation', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."file_folder_kind" AS ENUM('normal', 'shared', 'privateRoot', 'personal');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TYPE "public"."file_variant_status" AS ENUM('none', 'pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."unmatched_account_policy" AS ENUM('reject', 'auto_create');--> statement-breakpoint
CREATE TYPE "public"."grant_level" AS ENUM('viewer', 'contributor', 'editor', 'manager');--> statement-breakpoint
CREATE TYPE "public"."grant_subject_type" AS ENUM('role', 'user', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('fileFolder');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'inactive', 'locked');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"subject_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"private_payload" jsonb,
	"requester_id" uuid,
	"requester_name" text NOT NULL,
	"reason" text,
	"reviewer_id" uuid,
	"reviewer_name" text,
	"review_comment" text,
	"reviewed_at" timestamp with time zone,
	"result_resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_reviewed_consistency" CHECK (("approval_requests"."status" = 'pending') = ("approval_requests"."reviewed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"resource_name" text,
	"result" "audit_result" NOT NULL,
	"error_code" text,
	"changes" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_logs_archive" (
	"id" bigint PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"resource_name" text,
	"result" "audit_result" NOT NULL,
	"error_code" text,
	"changes" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"inherit_grants" boolean DEFAULT true NOT NULL,
	"kind" "file_folder_kind" DEFAULT 'normal' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_folders_personal_has_owner" CHECK (("file_folders"."kind" = 'personal') = ("file_folders"."owner_id" IS NOT NULL)),
	CONSTRAINT "file_folders_not_own_parent" CHECK ("file_folders"."parent_id" IS NULL OR "file_folders"."parent_id" <> "file_folders"."id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"etag" text,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"upload_id" text,
	"has_thumbnail" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"variant_status" "file_variant_status" DEFAULT 'none' NOT NULL,
	"image_width" integer,
	"image_height" integer,
	"variant_format" text,
	"folder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "files_size_non_negative" CHECK ("files"."size" >= 0),
	CONSTRAINT "files_ready_confirmed" CHECK ("files"."status" = 'pending' OR ("files"."etag" IS NOT NULL AND "files"."uploaded_at" IS NOT NULL)),
	CONSTRAINT "files_variant_ready_described" CHECK ("files"."variant_status" <> 'ready' OR ("files"."image_width" IS NOT NULL AND "files"."image_height" IS NOT NULL AND "files"."variant_format" IS NOT NULL))
);
--> statement-breakpoint
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
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"name_i18n_key" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key"),
	CONSTRAINT "permissions_key_format" CHECK ("permissions"."key" = "permissions"."resource" || ':' || "permissions"."action")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
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
CREATE TABLE "resource_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" "resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"subject_type" "grant_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"level" "grant_level" NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"username" "citext",
	"display_name" text NOT NULL,
	"password_hash" text,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"locale" text DEFAULT 'zh-TW' NOT NULL,
	"timezone" text DEFAULT 'Asia/Taipei' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_parent_id_file_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_domains" ADD CONSTRAINT "identity_provider_domains_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_subject_key" ON "approval_requests" USING btree ("type","subject_key") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_status_created_idx" ON "approval_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_requests_created_idx" ON "approval_requests" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_idx" ON "audit_logs" USING btree ("occurred_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action" text_pattern_ops,"occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_occurred_idx" ON "audit_logs_archive" USING btree ("occurred_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_actor_idx" ON "audit_logs_archive" USING btree ("actor_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_archive_resource_idx" ON "audit_logs_archive" USING btree ("resource_type","resource_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose") WHERE "auth_tokens"."used_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_parent_name_key" ON "file_folders" USING btree (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "file_folders_parent_idx" ON "file_folders" USING btree ("parent_id") WHERE "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_singleton_kind_key" ON "file_folders" USING btree ("kind") WHERE "file_folders"."kind" IN ('shared', 'privateRoot') AND "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_personal_owner_key" ON "file_folders" USING btree ("owner_id") WHERE "file_folders"."kind" = 'personal' AND "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_key" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_status_created_at_idx" ON "files" USING btree ("status","created_at") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_status_name_idx" ON "files" USING btree ("status","name","id") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_status_size_idx" ON "files" USING btree ("status","size","id") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_folder_created_at_idx" ON "files" USING btree ("folder_id","created_at","id") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_status_content_type_idx" ON "files" USING btree ("status","content_type") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_variant_pending_idx" ON "files" USING btree ("uploaded_at") WHERE "files"."variant_status" = 'pending' AND "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_name_trgm_idx" ON "files" USING gin ("name" gin_trgm_ops) WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "identity_provider_domains_provider_idx" ON "identity_provider_domains" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_providers_name_key" ON "identity_providers" USING btree ("name") WHERE "identity_providers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oidc_payloads_grant_idx" ON "oidc_payloads" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oidc_payloads_uid_idx" ON "oidc_payloads" USING btree ("type","uid");--> statement-breakpoint
CREATE INDEX "oidc_payloads_expires_idx" ON "oidc_payloads" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_resource_action_key" ON "permissions" USING btree ("resource","action");--> statement-breakpoint
CREATE INDEX "permissions_sort_idx" ON "permissions" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_active_idx" ON "refresh_tokens" USING btree ("user_id") WHERE "refresh_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_idp_session_idx" ON "refresh_tokens" USING btree ("idp_session_uid") WHERE "refresh_tokens"."idp_session_uid" IS NOT NULL AND "refresh_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_grants_resource_subject_key" ON "resource_grants" USING btree ("resource_type","resource_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "resource_grants_subject_idx" ON "resource_grants" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_slug_key" ON "roles" USING btree ("slug") WHERE "roles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_key" ON "roles" USING btree ("name") WHERE "roles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username") WHERE "users"."deleted_at" IS NULL AND "users"."username" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at" DESC NULLS LAST);
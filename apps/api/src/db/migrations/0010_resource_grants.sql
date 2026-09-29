CREATE TYPE "public"."grant_level" AS ENUM('viewer', 'contributor', 'editor', 'manager');--> statement-breakpoint
CREATE TYPE "public"."grant_subject_type" AS ENUM('role', 'user');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('fileFolder');--> statement-breakpoint
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
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_grants_resource_subject_key" ON "resource_grants" USING btree ("resource_type","resource_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "resource_grants_subject_idx" ON "resource_grants" USING btree ("subject_type","subject_id");--> statement-breakpoint

-- 資料夾層級授權的兩個權限鍵（docs/rbac/02-permission-catalog.md §2.7）。
-- seed 只在角色「新建立」時寫入權限（rbac/05-seed-and-bootstrap.md §4.2），既有環境的系統角色由這裡補上。
INSERT INTO permissions (key, resource, action, name_i18n_key, sort_order) VALUES
  ('file:access', 'file', 'access', 'permission.file.access', 704),
  ('file:share', 'file', 'share', 'permission.file.share', 705)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'file:share'
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'file:access'
WHERE r.slug = 'member' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

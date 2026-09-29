-- 工作區（docs/adr/0018-workspace-tenancy.md）。drizzle-kit 產生後手動調整：
-- 既有資料要先回填 workspace_id 才能設 NOT NULL；組合外鍵的參照目標（唯一索引）要先建立；
-- 角色依範圍拆分、既有指派搬進預設工作區（D18）。

-- ── 新的型別與資料表 ───────────────────────────────────────────
CREATE TYPE "public"."permission_scope" AS ENUM('platform', 'workspace');--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid,
	"last_accessed_at" timestamp with time zone,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_member_roles" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "workspace_member_roles_workspace_id_user_id_role_id_pk" PRIMARY KEY("workspace_id","user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_roles" ADD CONSTRAINT "workspace_member_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_roles" ADD CONSTRAINT "workspace_member_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_roles" ADD CONSTRAINT "workspace_member_roles_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree ("slug") WHERE "workspaces"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_member_roles_role_idx" ON "workspace_member_roles" USING btree ("role_id");--> statement-breakpoint

-- ── 預設工作區：既有的資料與所有使用者（D18）──────────────────
INSERT INTO "workspaces" ("slug", "name", "description")
VALUES ('default', '預設工作區', '升級到工作區時建立：既有的資料夾、檔案與成員都在這裡。');--> statement-breakpoint
INSERT INTO "workspace_members" ("workspace_id", "user_id")
SELECT w."id", u."id"
FROM "workspaces" w CROSS JOIN "users" u
WHERE w."slug" = 'default' AND u."deleted_at" IS NULL;--> statement-breakpoint

-- ── 檔案與資料夾歸進預設工作區，改用組合外鍵（D10）──────────────
ALTER TABLE "file_folders" DROP CONSTRAINT "file_folders_parent_id_file_folders_id_fk";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_folder_id_file_folders_id_fk";--> statement-breakpoint
DROP INDEX "file_folders_parent_name_key";--> statement-breakpoint
DROP INDEX "file_folders_singleton_kind_key";--> statement-breakpoint
DROP INDEX "file_folders_personal_owner_key";--> statement-breakpoint
ALTER TABLE "file_folders" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
UPDATE "file_folders" SET "workspace_id" = (SELECT "id" FROM "workspaces" WHERE "slug" = 'default');--> statement-breakpoint
UPDATE "files" SET "workspace_id" = (SELECT "id" FROM "workspaces" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "file_folders" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_workspace_id_key" ON "file_folders" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."file_folders"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_fk" FOREIGN KEY ("workspace_id","folder_id") REFERENCES "public"."file_folders"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_folders_workspace_idx" ON "file_folders" USING btree ("workspace_id") WHERE "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_workspace_created_at_idx" ON "files" USING btree ("workspace_id","status","created_at","id") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_parent_name_key" ON "file_folders" USING btree ("workspace_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_singleton_kind_key" ON "file_folders" USING btree ("workspace_id","kind") WHERE "file_folders"."kind" IN ('shared', 'privateRoot') AND "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_personal_owner_key" ON "file_folders" USING btree ("workspace_id","owner_id") WHERE "file_folders"."kind" = 'personal' AND "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
-- 資料夾存取申請的 payload 帶上工作區（審核時以審核者在該工作區的權限判斷）
UPDATE "approval_requests"
SET "payload" = "payload" || jsonb_build_object('workspaceId', (SELECT "id" FROM "workspaces" WHERE "slug" = 'default'))
WHERE "type" = 'fileFolder.access' AND NOT ("payload" ? 'workspaceId');--> statement-breakpoint

-- ── 權限鍵與角色的範圍（D2、D3）────────────────────────────────
ALTER TABLE "permissions" ADD COLUMN "scope" "permission_scope" DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "scope" "permission_scope" DEFAULT 'platform' NOT NULL;--> statement-breakpoint
CREATE INDEX "roles_scope_idx" ON "roles" USING btree ("scope") WHERE "roles"."deleted_at" IS NULL;--> statement-breakpoint
UPDATE "permissions" SET "scope" = 'workspace' WHERE "resource" = 'file';--> statement-breakpoint
-- 新的權限鍵（docs/rbac/02-permission-catalog.md）。seed 只在角色新建立時寫入權限，既有環境由這裡補上
INSERT INTO "permissions" ("key", "resource", "action", "scope", "name_i18n_key", "sort_order") VALUES
  ('workspace:create', 'workspace', 'create', 'platform', 'permission.workspace.create', 900),
  ('workspace:read', 'workspace', 'read', 'platform', 'permission.workspace.read', 901),
  ('workspace:update', 'workspace', 'update', 'platform', 'permission.workspace.update', 902),
  ('workspace:delete', 'workspace', 'delete', 'platform', 'permission.workspace.delete', 903),
  ('workspaceMember:read', 'workspaceMember', 'read', 'workspace', 'permission.workspaceMember.read', 1000),
  ('workspaceMember:create', 'workspaceMember', 'create', 'workspace', 'permission.workspaceMember.create', 1001),
  ('workspaceMember:delete', 'workspaceMember', 'delete', 'workspace', 'permission.workspaceMember.delete', 1002),
  ('workspaceMember:assignRole', 'workspaceMember', 'assignRole', 'workspace', 'permission.workspaceMember.assignRole', 1003)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'workspace'
WHERE r."slug" = 'admin' AND r."is_system" AND r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'workspace:read'
WHERE r."slug" = 'auditor' AND r."is_system" AND r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- ── 角色拆分（D18）───────────────────────────────────────────
-- 含工作區範圍權限鍵、或是資料夾授權對象的角色：另建一個工作區角色，工作區範圍的鍵搬過去，
-- 持有者在預設工作區取得它，資料夾授權改指向它。原角色留下平台範圍的鍵（可能變成空的）。
CREATE TEMP TABLE "role_split" ("old_id" uuid PRIMARY KEY, "new_id" uuid NOT NULL);--> statement-breakpoint
INSERT INTO "role_split" ("old_id", "new_id")
SELECT r."id", gen_random_uuid()
FROM "roles" r
WHERE r."deleted_at" IS NULL
  AND r."slug" <> 'super-admin'
  AND (
    EXISTS (
      SELECT 1 FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permission_id"
      WHERE rp."role_id" = r."id" AND p."scope" = 'workspace'
    )
    OR EXISTS (
      SELECT 1 FROM "resource_grants" g WHERE g."subject_type" = 'role' AND g."subject_id" = r."id"
    )
  );--> statement-breakpoint
INSERT INTO "roles" ("id", "slug", "name", "description", "is_system", "scope", "created_at", "updated_at")
SELECT
  s."new_id",
  CASE r."slug"
    WHEN 'admin' THEN 'workspace-admin'
    WHEN 'member' THEN 'workspace-member'
    WHEN 'auditor' THEN 'workspace-viewer'
    ELSE left(r."slug", 40) || '-ws-' || left(s."new_id"::text, 4)
  END,
  CASE WHEN r."is_system" AND r."slug" = 'admin' THEN '工作區管理員'
       WHEN r."is_system" AND r."slug" = 'member' THEN '工作區成員'
       WHEN r."is_system" AND r."slug" = 'auditor' THEN '工作區檢視者'
       ELSE r."name" || '（工作區）'
  END,
  -- 系統工作區角色用 seed 的說明（roles.ts）；自訂角色沿用原本的說明
  CASE WHEN r."is_system" AND r."slug" = 'admin' THEN '管理工作區的成員與角色，存取工作區裡的所有檔案。'
       WHEN r."is_system" AND r."slug" = 'member' THEN '進入檔案管理器；能看到、能做什麼由資料夾授權決定。'
       WHEN r."is_system" AND r."slug" = 'auditor' THEN '唯讀存取工作區裡的所有檔案與成員清單。'
       ELSE r."description"
  END,
  r."is_system" AND r."slug" IN ('admin', 'member', 'auditor'),
  'workspace',
  now(),
  now()
FROM "role_split" s JOIN "roles" r ON r."id" = s."old_id";--> statement-breakpoint
UPDATE "role_permissions" rp
SET "role_id" = s."new_id"
FROM "role_split" s, "permissions" p
WHERE rp."role_id" = s."old_id" AND p."id" = rp."permission_id" AND p."scope" = 'workspace';--> statement-breakpoint
-- 系統工作區角色：管理員管理成員，一般成員看得到成員清單
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'workspaceMember'
WHERE r."slug" = 'workspace-admin' AND r."scope" = 'workspace' AND r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'workspaceMember:read'
WHERE r."slug" IN ('workspace-member', 'workspace-viewer') AND r."scope" = 'workspace' AND r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "workspace_member_roles" ("workspace_id", "user_id", "role_id", "granted_at", "granted_by")
SELECT m."workspace_id", ur."user_id", s."new_id", ur."granted_at", ur."granted_by"
FROM "user_roles" ur
JOIN "role_split" s ON s."old_id" = ur."role_id"
JOIN "workspace_members" m ON m."user_id" = ur."user_id"
JOIN "workspaces" w ON w."id" = m."workspace_id" AND w."slug" = 'default';--> statement-breakpoint
UPDATE "resource_grants" g
SET "subject_id" = s."new_id"
FROM "role_split" s
WHERE g."subject_type" = 'role' AND g."subject_id" = s."old_id";--> statement-breakpoint
INSERT INTO "audit_logs" ("action", "actor_id", "actor_email", "resource_type", "resource_id", "resource_name", "result", "changes", "metadata")
SELECT 'role.create', NULL, 'system', 'role', s."new_id"::text, n."name", 'success',
  jsonb_build_object('after', jsonb_build_object('name', n."name", 'scope', 'workspace', 'source', o."slug")),
  jsonb_build_object('reason', 'workspace-migration')
FROM "role_split" s
JOIN "roles" o ON o."id" = s."old_id"
JOIN "roles" n ON n."id" = s."new_id";--> statement-breakpoint
DROP TABLE "role_split";--> statement-breakpoint

-- ── 不變條件：角色只能含同範圍的鍵、只能指派在對應的地方（D3）───────
CREATE OR REPLACE FUNCTION enforce_role_scope() RETURNS trigger AS $$
DECLARE
  role_scope permission_scope;
  expected permission_scope;
BEGIN
  SELECT "scope" INTO role_scope FROM "roles" WHERE "id" = NEW."role_id";
  IF TG_TABLE_NAME = 'role_permissions' THEN
    SELECT "scope" INTO expected FROM "permissions" WHERE "id" = NEW."permission_id";
  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    expected := 'platform';
  ELSE
    expected := 'workspace';
  END IF;
  IF role_scope IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ROLE_SCOPE_MISMATCH: role % has scope %, % requires %',
      NEW."role_id", role_scope, TG_TABLE_NAME, expected;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "role_permissions_scope" ON "role_permissions";--> statement-breakpoint
CREATE TRIGGER "role_permissions_scope" BEFORE INSERT OR UPDATE ON "role_permissions"
  FOR EACH ROW EXECUTE FUNCTION enforce_role_scope();--> statement-breakpoint
DROP TRIGGER IF EXISTS "user_roles_scope" ON "user_roles";--> statement-breakpoint
CREATE TRIGGER "user_roles_scope" BEFORE INSERT OR UPDATE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION enforce_role_scope();--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_member_roles_scope" ON "workspace_member_roles";--> statement-breakpoint
CREATE TRIGGER "workspace_member_roles_scope" BEFORE INSERT OR UPDATE ON "workspace_member_roles"
  FOR EACH ROW EXECUTE FUNCTION enforce_role_scope();--> statement-breakpoint
-- 範圍建立後不可變：改了會讓既有的權限與指派全部失去意義
CREATE OR REPLACE FUNCTION roles_scope_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."scope" <> OLD."scope" THEN
    RAISE EXCEPTION 'ROLE_SCOPE_MISMATCH: cannot change scope of role %', OLD."slug";
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "roles_scope_immutable" ON "roles";--> statement-breakpoint
CREATE TRIGGER "roles_scope_immutable" BEFORE UPDATE ON "roles"
  FOR EACH ROW EXECUTE FUNCTION roles_scope_immutable();--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspaces_set_updated_at" ON "workspaces";--> statement-breakpoint
CREATE TRIGGER "workspaces_set_updated_at" BEFORE UPDATE ON "workspaces"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_resource_version_key" UNIQUE("resource_type","resource_id","version")
);
--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revisions_created_at_idx" ON "revisions" USING btree ("created_at");--> statement-breakpoint
-- 手寫：既有角色的基準版本（docs/architecture/backend/14-revisions.md §4.2、ADR-0025 R5）。
-- 每個角色（含已刪除、之後可能被還原的）以 migration 當下的名稱、說明與權限鍵寫入第 1 版，actor 為 null（系統）。
-- 快照的形狀與 modules/role/role-revision.ts 的 toRoleRevision() 相同；權限鍵與 RoleRepository.listPermissions 相同
-- （只算目錄裡的鍵），以 COLLATE "C" 排序才與 JS 的預設排序（UTF-16 碼位）一致。
-- 與前一版程式相容：舊版不讀寫這張表。滾動部署期間舊版做的變更沒有版本（舊版建立的角色沒有第 1 版），
-- 新版之後的第一次寫入照常記下寫入後的狀態，最新一版仍等於目前的內容。
INSERT INTO "revisions" ("resource_type", "resource_id", "version", "snapshot", "actor_id")
SELECT
  'role',
  r.id,
  1,
  jsonb_build_object(
    'name', r.name,
    'description', r.description,
    'permissionKeys', COALESCE(
      (
        SELECT jsonb_agg(p.key ORDER BY p.key COLLATE "C")
        FROM "relation_tuples" t
        INNER JOIN "permissions" p ON p.key = t.relation
        WHERE t.object_type = 'tenant' AND t.object_id = 'self'
          AND t.subject_type = 'role' AND t.subject_relation = 'holder'
          AND t.relation <> 'superAdmin'
          AND t.subject_id = r.id::text
      ),
      '[]'::jsonb
    )
  ),
  NULL
FROM "roles" r
ON CONFLICT DO NOTHING;

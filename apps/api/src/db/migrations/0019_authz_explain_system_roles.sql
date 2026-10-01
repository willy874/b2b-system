-- 既有租戶的系統角色補上 authz:explain（docs/architecture/backend/02-database.md §6：seed 只在角色新建立時寫入權限，
-- 已存在的系統角色要補新權限時寫一支手寫 migration）。與 db/seeds/roles.ts 一致：admin 與 auditor 都取得 authz:explain。
-- 新建立的租戶在這支 migration 執行時還沒有角色，這裡不插入任何列，由 seed 寫入。
-- 邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。

INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', 'authz:explain', 'role', r.id::text, 'holder'
FROM roles r
WHERE r.slug IN ('admin', 'auditor') AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

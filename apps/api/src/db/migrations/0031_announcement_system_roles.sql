-- 既有租戶的系統角色補上 announcement:*（與 0025、0027、0029 同一個做法：seed 只在角色新建立時寫入權限）。
-- 與 db/seeds/roles.ts 一致：admin 取得五個鍵、auditor 取得 read（docs/adr/0031-announcements.md D15）。
-- 邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。

INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', k.key, 'role', r.id::text, 'holder'
FROM roles r
CROSS JOIN (VALUES
  ('announcement:create'),
  ('announcement:read'),
  ('announcement:update'),
  ('announcement:delete'),
  ('announcement:publish')
) AS k(key)
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', 'announcement:read', 'role', r.id::text, 'holder'
FROM roles r
WHERE r.slug = 'auditor' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

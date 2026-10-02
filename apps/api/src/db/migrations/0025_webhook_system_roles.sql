-- 既有租戶的系統角色補上 webhook:*（與 0023 同一個做法：seed 只在角色新建立時寫入權限）。
-- 與 db/seeds/roles.ts 一致：admin 取得四個鍵、auditor 取得 read（docs/adr/0030-webhooks.md D6）。
-- 邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。

INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', k.key, 'role', r.id::text, 'holder'
FROM roles r
CROSS JOIN (VALUES
  ('webhook:create'),
  ('webhook:read'),
  ('webhook:update'),
  ('webhook:delete')
) AS k(key)
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', 'webhook:read', 'role', r.id::text, 'holder'
FROM roles r
WHERE r.slug = 'auditor' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

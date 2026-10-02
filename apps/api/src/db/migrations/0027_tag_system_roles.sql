-- 既有租戶的 admin 補上 tag:*（與 0023、0025 同一個做法：seed 只在角色新建立時寫入權限）。
-- 與 db/seeds/roles.ts 一致：admin 取得三個鍵（docs/adr/0032-tags.md D5）；auditor 不變（標籤沒有 read 鍵）。
-- 邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。

INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', k.key, 'role', r.id::text, 'holder'
FROM roles r
CROSS JOIN (VALUES
  ('tag:create'),
  ('tag:update'),
  ('tag:delete')
) AS k(key)
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

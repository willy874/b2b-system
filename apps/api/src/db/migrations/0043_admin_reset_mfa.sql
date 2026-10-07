-- 既有租戶的 admin 補上 user:resetMfa（與 0023、0025、0027、0029、0031 同一個做法：seed 只在角色新建立時寫入權限）。
-- 重設 MFA 原本只要 user:update，改成獨立的權限後（docs/architecture/backend/21-mfa.md §15 第 12 點），
-- 預設的 admin 要保留這個能力，與 db/seeds/roles.ts 一致。自訂角色不補：只有 user:update 的角色從此不能重設 MFA。
-- 邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。

INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', 'user:resetMfa', 'role', r.id::text, 'holder'
FROM roles r
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

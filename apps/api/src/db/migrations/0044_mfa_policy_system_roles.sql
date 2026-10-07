-- 既有租戶的 admin、auditor 補上 mfaPolicy:read（與 0029、0031、0043 同一個做法：seed 只在角色新建立時寫入權限）。
-- 0042 加入 MFA 政策時漏了這一步：既有租戶的 admin、auditor 看不到系統設定的「安全性」分頁（docs/architecture/backend/21-mfa.md §6）。
-- 與 db/seeds/roles.ts 一致；mfaPolicy:update 預設只給 super-admin（D11），不補。
-- 邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。

INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', 'mfaPolicy:read', 'role', r.id::text, 'holder'
FROM roles r
WHERE r.slug IN ('admin', 'auditor') AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

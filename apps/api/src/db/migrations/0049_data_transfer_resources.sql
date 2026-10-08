-- 匯入匯出擴充到角色、群組、組織、標籤、審批、服務帳號（docs/architecture/backend/22-data-transfer.md §12）：
-- 每種資源的匯出要獨立的權限（§12 D11）。與 db/seeds/roles.ts 一致：admin 有六個新的匯出權限；auditor 有 approval:export。
INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', p.key, 'role', r.id::text, 'holder'
FROM roles r
CROSS JOIN (
  VALUES
    ('role:export', 'admin'),
    ('approval:export', 'admin'),
    ('group:export', 'admin'),
    ('serviceAccount:export', 'admin'),
    ('tag:export', 'admin'),
    ('orgUnit:export', 'admin'),
    ('approval:export', 'auditor')
) AS p(key, slug)
WHERE r.slug = p.slug AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

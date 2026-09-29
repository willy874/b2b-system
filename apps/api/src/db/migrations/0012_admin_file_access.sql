-- 手寫 migration：admin 也持有 file:access（docs/rbac/02-permission-catalog.md §4）。
-- member 有 file:access 之後，指派 member（含核准註冊時指派）受反提權限制：授予者必須持有該角色的每個權限鍵。
-- admin 已有全域 file:*，file:access 不擴大它的能力，只讓它能繼續指派 member。
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'file:access'
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

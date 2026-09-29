-- 背景工作的兩個權限鍵（docs/rbac/02-permission-catalog.md §2.8）。
-- seed 只在角色「新建立」時寫入權限（rbac/05-seed-and-bootstrap.md §4.2），既有環境的系統角色由這裡補上。
INSERT INTO permissions (key, resource, action, name_i18n_key, sort_order) VALUES
  ('job:read', 'job', 'read', 'permission.job.read', 800),
  ('job:retry', 'job', 'retry', 'permission.job.retry', 801)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('job:read', 'job:retry')
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'job:read'
WHERE r.slug = 'auditor' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

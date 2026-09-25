-- 手寫 migration：審批請求的 updated_at 與新權限的授予（docs/rbac/06-approval.md）

-- ── updated_at 自動更新（函式在 0001 建立）────────────────────
DROP TRIGGER IF EXISTS approval_requests_set_updated_at ON approval_requests;
--> statement-breakpoint

CREATE TRIGGER approval_requests_set_updated_at BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ── 新權限授予既有的系統角色 ──────────────────────────────────
-- seed 只在系統角色「新建立」時寫入權限（docs/rbac/05-seed-and-bootstrap.md §4.2），
-- 既有環境要靠這裡補上。全新的資料庫此時還沒有任何角色，以下語句不影響任何列；
-- 之後由 seed 建立角色時一併授予。
INSERT INTO permissions (key, resource, action, name_i18n_key, sort_order)
VALUES
  ('approval:read', 'approval', 'read', 'permission.approval.read', 600),
  ('approval:review', 'approval', 'review', 'permission.approval.review', 601)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('approval:read', 'approval:review')
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'approval:read'
WHERE r.slug = 'auditor' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

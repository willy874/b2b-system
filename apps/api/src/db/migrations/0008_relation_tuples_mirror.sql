-- 手寫 migration：從舊表回填 relation_tuples，並在舊表上掛 trigger 同一交易雙寫
-- （docs/adr/0024-relationship-based-access-control.md 的 G1；對照見 docs/features/permission-graph.md §2）。
--
--   user_roles (u, r)                 → role:r#holder@user:u
--   role_permissions (r, p)           → tenant:self#<p.key>@role:r#holder
--   resource_grants (type, id, s, l)  → <type>:<id>#<level>@(role:s#holder | user:s | user:*)
--   roles.slug = 'super-admin'        → tenant:self#superAdmin@role:<id>#holder（它在 role_permissions 沒有列）
--
-- 舊表仍是事實來源；G3 改由程式直接寫入時，刪掉這些 trigger 與舊表。
-- TRUNCATE 不會觸發 row trigger：清空舊表的地方（test/db.ts、db/reset.ts）要一併清空 relation_tuples。

-- ── user_roles ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION relation_tuples_mirror_user_roles() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    DELETE FROM relation_tuples
    WHERE object_type = 'role' AND object_id = OLD.role_id::text AND relation = 'holder'
      AND subject_type = 'user' AND subject_id = OLD.user_id::text AND subject_relation = '';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO relation_tuples
      (object_type, object_id, relation, subject_type, subject_id, subject_relation, created_at, created_by)
    VALUES ('role', NEW.role_id::text, 'holder', 'user', NEW.user_id::text, '', NEW.granted_at, NEW.granted_by)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_roles_mirror_tuples ON user_roles;
--> statement-breakpoint

CREATE TRIGGER user_roles_mirror_tuples
  AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION relation_tuples_mirror_user_roles();
--> statement-breakpoint

-- ── role_permissions（permission_id 的外鍵是 restrict，trigger 執行時一定查得到 key）──
CREATE OR REPLACE FUNCTION relation_tuples_mirror_role_permissions() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    DELETE FROM relation_tuples
    WHERE object_type = 'tenant' AND object_id = 'self'
      AND relation = (SELECT key FROM permissions WHERE id = OLD.permission_id)
      AND subject_type = 'role' AND subject_id = OLD.role_id::text AND subject_relation = 'holder';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO relation_tuples
      (object_type, object_id, relation, subject_type, subject_id, subject_relation, created_at, created_by)
    SELECT 'tenant', 'self', p.key, 'role', NEW.role_id::text, 'holder', NEW.granted_at, NEW.granted_by
    FROM permissions p WHERE p.id = NEW.permission_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS role_permissions_mirror_tuples ON role_permissions;
--> statement-breakpoint

CREATE TRIGGER role_permissions_mirror_tuples
  AFTER INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION relation_tuples_mirror_role_permissions();
--> statement-breakpoint

-- ── resource_grants（upsert 會原地改 level：先刪舊的邊再插新的）──
CREATE OR REPLACE FUNCTION relation_tuples_grant_subject(
  grant_type grant_subject_type, grant_subject uuid,
  OUT tuple_subject_type text, OUT tuple_subject_id text, OUT tuple_subject_relation text
) AS $$
BEGIN
  CASE grant_type
    WHEN 'role' THEN
      tuple_subject_type := 'role'; tuple_subject_id := grant_subject::text; tuple_subject_relation := 'holder';
    WHEN 'user' THEN
      tuple_subject_type := 'user'; tuple_subject_id := grant_subject::text; tuple_subject_relation := '';
    ELSE
      -- everyone：所有人（萬用字元）；EVERYONE_SUBJECT_ID 只是唯一索引用的固定值
      tuple_subject_type := 'user'; tuple_subject_id := '*'; tuple_subject_relation := '';
  END CASE;
END; $$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION relation_tuples_mirror_resource_grants() RETURNS trigger AS $$
DECLARE
  s record;
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    s := relation_tuples_grant_subject(OLD.subject_type, OLD.subject_id);
    DELETE FROM relation_tuples
    WHERE object_type = OLD.resource_type::text AND object_id = OLD.resource_id::text
      AND relation = OLD.level::text
      AND subject_type = s.tuple_subject_type AND subject_id = s.tuple_subject_id
      AND subject_relation = s.tuple_subject_relation;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    s := relation_tuples_grant_subject(NEW.subject_type, NEW.subject_id);
    INSERT INTO relation_tuples
      (object_type, object_id, relation, subject_type, subject_id, subject_relation, expires_at, created_at, created_by)
    VALUES (NEW.resource_type::text, NEW.resource_id::text, NEW.level::text,
            s.tuple_subject_type, s.tuple_subject_id, s.tuple_subject_relation,
            NEW.expires_at, NEW.granted_at, NEW.granted_by)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS resource_grants_mirror_tuples ON resource_grants;
--> statement-breakpoint

CREATE TRIGGER resource_grants_mirror_tuples
  AFTER INSERT OR UPDATE OR DELETE ON resource_grants
  FOR EACH ROW EXECUTE FUNCTION relation_tuples_mirror_resource_grants();
--> statement-breakpoint

-- ── super-admin 角色（slug 在系統角色上不可改，見 0001 的 protect_system_roles）──
CREATE OR REPLACE FUNCTION relation_tuples_mirror_super_admin() RETURNS trigger AS $$
BEGIN
  IF NEW.slug = 'super-admin' THEN
    INSERT INTO relation_tuples
      (object_type, object_id, relation, subject_type, subject_id, subject_relation, created_at)
    VALUES ('tenant', 'self', 'superAdmin', 'role', NEW.id::text, 'holder', NEW.created_at)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS roles_mirror_super_admin ON roles;
--> statement-breakpoint

CREATE TRIGGER roles_mirror_super_admin
  AFTER INSERT ON roles
  FOR EACH ROW EXECUTE FUNCTION relation_tuples_mirror_super_admin();
--> statement-breakpoint

-- ── 回填既有資料 ───────────────────────────────────────────────
INSERT INTO relation_tuples
  (object_type, object_id, relation, subject_type, subject_id, subject_relation, created_at, created_by)
SELECT 'role', ur.role_id::text, 'holder', 'user', ur.user_id::text, '', ur.granted_at, ur.granted_by
FROM user_roles ur
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO relation_tuples
  (object_type, object_id, relation, subject_type, subject_id, subject_relation, created_at, created_by)
SELECT 'tenant', 'self', p.key, 'role', rp.role_id::text, 'holder', rp.granted_at, rp.granted_by
FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO relation_tuples
  (object_type, object_id, relation, subject_type, subject_id, subject_relation, expires_at, created_at, created_by)
SELECT g.resource_type::text, g.resource_id::text, g.level::text,
       s.tuple_subject_type, s.tuple_subject_id, s.tuple_subject_relation,
       g.expires_at, g.granted_at, g.granted_by
FROM resource_grants g
CROSS JOIN LATERAL relation_tuples_grant_subject(g.subject_type, g.subject_id) s
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO relation_tuples
  (object_type, object_id, relation, subject_type, subject_id, subject_relation, created_at)
SELECT 'tenant', 'self', 'superAdmin', 'role', r.id::text, 'holder', r.created_at
FROM roles r WHERE r.slug = 'super-admin'
ON CONFLICT DO NOTHING;

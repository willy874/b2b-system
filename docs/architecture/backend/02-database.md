# 後端 02 — 資料庫

## 1. 慣例

| 對象         | 慣例                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| 表名         | 複數 snake_case：`users`、`role_permissions`                             |
| 欄位         | snake_case：`created_at`、`token_version`                                |
| 主鍵         | `uuid`，`DEFAULT gen_random_uuid()`（`audit_logs` 例外，用 `bigserial`） |
| 時間         | `timestamptz`，一律存 UTC                                                |
| 布林         | `NOT NULL DEFAULT false`，不允許三態                                     |
| 軟刪除       | `deleted_at timestamptz`，唯一索引都帶 `WHERE deleted_at IS NULL`        |
| Drizzle 變數 | camelCase 複數：`rolePermissions`                                        |
| 列舉         | Postgres `enum` 型別（不是 `text` + `CHECK`），因為它會出現在 OpenAPI    |

必要擴充：

```sql
CREATE EXTENSION IF NOT EXISTS citext;     -- 大小寫不敏感的 email / username
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
```

---

## 2. Schema

### 2.1 `users`

```ts
// db/schema/users.ts
export const userStatus = pgEnum("user_status", ["pending", "active", "inactive", "locked"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    username: citext("username"),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash"), // pending 時為 null
    status: userStatus("status").notNull().default("pending"),

    // 撤銷機制：+1 即讓該使用者所有既存 access token 失效
    tokenVersion: integer("token_version").notNull().default(0),

    // 暴力破解防護
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    // 偏好
    locale: text("locale").notNull().default("zh-TW"),
    timezone: text("timezone").notNull().default("Asia/Taipei"),

    mfaEnabled: boolean("mfa_enabled").notNull().default(false), // 預留

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_key")
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex("users_username_key")
      .on(t.username)
      .where(sql`${t.deletedAt} IS NULL AND ${t.username} IS NOT NULL`),
    index("users_status_idx")
      .on(t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index("users_created_at_idx").on(t.createdAt.desc()),
  ],
);
```

**partial unique index 的價值**：軟刪除一個 `alice@example.com` 之後，同一個
email 可以再次被註冊。全表唯一索引做不到這件事。

### 2.2 `roles`

```ts
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(), // 程式碼參照，建立後不可變
    name: text("name").notNull(), // 顯示名稱，可改
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("roles_slug_key")
      .on(t.slug)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex("roles_name_key")
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
```

### 2.3 `permissions`

```ts
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(), // 'role:update'
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    nameI18nKey: text("name_i18n_key").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // I2：key 必須等於 resource:action，由 DB 保證
    check("permissions_key_format", sql`${t.key} = ${t.resource} || ':' || ${t.action}`),
    uniqueIndex("permissions_resource_action_key").on(t.resource, t.action),
    index("permissions_sort_idx").on(t.sortOrder),
  ],
);
```

**沒有 `deleted_at`**：權限目錄不軟刪除。要移除一個權限就是明確的 migration，
連帶處理 `role_permissions`。

### 2.4 `user_roles`

```ts
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_idx").on(t.roleId), // 「誰持有這個角色」＋ 快取失效用
  ],
);
```

> **未來加作用域時**：在這裡加 `scopeType text` / `scopeId uuid`，主鍵擴成
> 四欄。見 [ADR-0006](../../adr/0006-flat-permission-scope.md)。

### 2.5 `role_permissions`

```ts
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index("role_permissions_permission_idx").on(t.permissionId),
  ],
);
```

`permission_id` 用 `onDelete: 'restrict'` 而非 `cascade`：刪除一個仍被授予的
權限應該被 **擋下**，逼開發者明確處理，而不是靜默撤掉一堆授權。

### 2.6 `refresh_tokens`

```ts
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(), // 一次登入 = 一條輪替鏈
    tokenHash: text("token_hash").notNull(), // SHA-256(token)，不存明文

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }), // 已輪替
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"), // logout | reuse_detected | user_disabled | password_reset

    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_key").on(t.tokenHash),
    index("refresh_tokens_family_idx").on(t.familyId),
    index("refresh_tokens_user_active_idx")
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    index("refresh_tokens_expires_idx").on(t.expiresAt), // 清理排程用
  ],
);
```

### 2.7 `auth_tokens`（啟用 / 密碼重設）

```ts
export const authTokenPurpose = pgEnum("auth_token_purpose", ["activation", "password_reset"]);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: authTokenPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_key").on(t.tokenHash),
    // 一個使用者同時只有一個有效的同用途 token：發新的時先作廢舊的
    index("auth_tokens_user_purpose_idx")
      .on(t.userId, t.purpose)
      .where(sql`${t.usedAt} IS NULL`),
  ],
);
```

### 2.8 `audit_logs`

```ts
export const auditResult = pgEnum("audit_result", ["success", "failure"]);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    // 操作者快照（刻意反正規化：使用者刪除後紀錄仍可讀，查詢不需 join）
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email").notNull(), // 系統操作填 'system'

    action: text("action").notNull(), // 'role.update'
    resourceType: text("resource_type").notNull(), // 'role'
    resourceId: text("resource_id"),
    resourceName: text("resource_name"), // 快照

    result: auditResult("result").notNull(),
    errorCode: text("error_code"),

    changes: jsonb("changes"), // { before: {...}, after: {...} }
    metadata: jsonb("metadata"), // { ip, userAgent, requestId, ... }
  },
  (t) => [
    index("audit_logs_occurred_idx").on(t.occurredAt.desc()),
    index("audit_logs_actor_idx").on(t.actorId, t.occurredAt.desc()),
    index("audit_logs_resource_idx").on(t.resourceType, t.resourceId, t.occurredAt.desc()),
    index("audit_logs_action_idx").on(t.action, t.occurredAt.desc()),
  ],
);
```

**沒有外鍵指向 `users`**：使用者被硬刪除時稽核紀錄必須留著。`actor_id` 只是
一個值，不是關聯。

---

## 3. 不變條件的 DB 層強制

以下寫在一支手寫 migration 裡（drizzle-kit 不產生 trigger）。

### 3.1 系統角色保護（I7）

```sql
CREATE OR REPLACE FUNCTION protect_system_roles() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot delete system role %', OLD.slug;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.slug <> OLD.slug THEN
      RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot rename slug of system role %', OLD.slug;
    END IF;
    IF NEW.is_system <> OLD.is_system THEN
      RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot change is_system flag';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER roles_protect_system
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION protect_system_roles();
```

Service 層已經會擋下這些操作。Trigger 是 **第二道防線**，涵蓋 CLI、
臨時腳本、誤用 repository 的情況。

### 3.2 稽核不可變（I12）

```sql
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit_logs is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
```

另外，應用程式使用的 DB role 只授予 `INSERT, SELECT`：

```sql
REVOKE UPDATE, DELETE ON audit_logs FROM game_editor_app;
```

> **保留期限的清理** 由另一個具備 `DELETE` 權限的維運 role 執行（或改用分區
> 表 `DROP PARTITION`，那是更好的作法，見 §7）。

### 3.3 `updated_at` 自動更新

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 4. 核心查詢

### 4.1 使用者的權限集合（最熱的查詢）

```ts
async getPermissionKeys(userId: string): Promise<string[]> {
  const rows = await this.db
    .selectDistinct({ key: permissions.key })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.key);
}
```

索引：`user_roles` 的主鍵 `(user_id, role_id)` 涵蓋起點，
`role_permissions` 的主鍵 `(role_id, permission_id)` 涵蓋中段，
`permissions` 的主鍵涵蓋終點。全部走 index-only scan。

### 4.2 是否為 super-admin

```ts
async isSuperAdmin(userId: string): Promise<boolean> {
  const [row] = await this.db
    .select({ one: sql<number>`1` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(
      eq(userRoles.userId, userId),
      eq(roles.slug, 'super-admin'),
      isNull(roles.deletedAt),
    ))
    .limit(1);
  return Boolean(row);
}
```

實務上與 §4.1 合併成一次查詢，避免兩次往返。

### 4.3 角色權限變更時，哪些使用者的快取要失效

```ts
async findUserIdsByRole(roleId: string): Promise<string[]> {
  const rows = await this.db.select({ userId: userRoles.userId })
    .from(userRoles).where(eq(userRoles.roleId, roleId));
  return rows.map((r) => r.userId);
}
```

靠 `user_roles_role_idx`。

### 4.4 使用者列表（含角色，避免 N+1）

```ts
const rows = await this.db
  .select({
    user: users,
    roles: sql<Array<{ id: string; slug: string; name: string }>>`
      COALESCE(
        json_agg(json_build_object('id', ${roles.id}, 'slug', ${roles.slug}, 'name', ${roles.name}))
          FILTER (WHERE ${roles.id} IS NOT NULL),
        '[]'
      )`,
  })
  .from(users)
  .leftJoin(userRoles, eq(userRoles.userId, users.id))
  .leftJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
  .where(and(isNull(users.deletedAt), ...filters))
  .groupBy(users.id)
  .orderBy(desc(users.createdAt))
  .limit(limit)
  .offset(offset);
```

一次查詢帶回使用者與其角色。**不要** 先查使用者再逐一查角色。

---

## 5. Migration 流程

```bash
# 1. 改 db/schema/*.ts
# 2. 產生 SQL
pnpm db:generate            # drizzle-kit generate → db/migrations/0004_xxx.sql
# 3. 人工檢視產生的 SQL（必要步驟，不可略過）
# 4. 套用
pnpm db:migrate
```

### 5.1 規則

| 規則                                                | 說明                                                     |
| --------------------------------------------------- | -------------------------------------------------------- |
| Migration 檔 **必須** 進版控                        | 它是資料庫狀態的唯一歷史                                 |
| 產生後 **必須** 人工檢視                            | drizzle-kit 對欄位改名可能產生「drop + add」導致資料遺失 |
| Trigger / function / 資料修補 用 **手寫** migration | drizzle-kit 不產生這些                                   |
| 已套用到任何共用環境的 migration **不可修改**       | 要改就發新的一支                                         |
| 破壞性變更拆成兩次部署                              | 先加新欄位並雙寫 → 部署 → 再移除舊欄位                   |

### 5.2 手寫 migration 的位置

```
db/migrations/
├── 0000_init.sql                  drizzle-kit 產生
├── 0001_triggers.sql              手寫：protect_system_roles / audit append-only
├── 0002_add_system_update.sql     drizzle-kit 產生
└── 0003_grant_system_update.ts    手寫：把新權限授予 admin 角色
```

`.ts` 的資料 migration 由一個小 runner 依序執行，與 `.sql` 共用同一張
`__drizzle_migrations` 記錄表。

---

## 6. 連線

```ts
// core/database/database.provider.ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const client = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === "production" ? 20 : 5,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {}, // 靜音 NOTICE
});

export const db = drizzle(client, { schema, logger: env.NODE_ENV === "development" });
```

`DatabaseModule` 是 `@Global()`，提供 `DRIZZLE` injection token。
應用程式關閉時（`OnApplicationShutdown`）呼叫 `client.end({ timeout: 5 })`。

---

## 7. 稽核日誌的成長

Phase 0 用單一表。當 `audit_logs` 超過約 1000 萬列時改成按月分區：

```sql
CREATE TABLE audit_logs (...) PARTITION BY RANGE (occurred_at);
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

好處：保留期清理變成 `DROP TABLE audit_logs_2025_09`（瞬間完成、不產生
bloat），而不是一個會鎖表數分鐘的大 `DELETE`。

**Phase 0 先不做**，但索引設計（全部以 `occurred_at` 開頭或結尾）已經是
分區友善的，改造時不需要改查詢。

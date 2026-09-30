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

### 2.8 `audit_logs` / `audit_logs_archive`（熱表／冷表）

稽核分成兩張欄位完全相同的表，分層理由與搬移流程見
[`06-audit-log.md`](./06-audit-log.md) §8。

```ts
export const auditResult = pgEnum("audit_result", ["success", "failure"]);

// 兩張表共用；欄位順序必須一致（archive_audit_logs() 與 UNION ALL 依賴它）
const auditLogColumns = () => ({
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
});

// 熱表：最近 90 天，所有寫入都進這裡
export const auditLogs = pgTable(
  "audit_logs",
  { id: bigserial("id", { mode: "bigint" }).primaryKey(), ...auditLogColumns() },
  (t) => [
    index("audit_logs_occurred_idx").on(t.occurredAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("audit_logs_actor_idx").on(t.actorId, t.occurredAt.desc().nullsFirst()),
    index("audit_logs_resource_idx").on(t.resourceType, t.resourceId, t.occurredAt.desc().nullsFirst()),
    index("audit_logs_action_idx").on(t.action.op("text_pattern_ops"), t.occurredAt.desc().nullsFirst()),
  ],
);

// 冷表：id 沿用熱表的值（不是 serial）；少一個 action 索引
export const auditLogsArchive = pgTable(
  "audit_logs_archive",
  { id: bigint("id", { mode: "bigint" }).primaryKey(), ...auditLogColumns() },
  (t) => [
    index("audit_logs_archive_occurred_idx").on(t.occurredAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("audit_logs_archive_actor_idx").on(t.actorId, t.occurredAt.desc().nullsFirst()),
    index("audit_logs_archive_resource_idx").on(t.resourceType, t.resourceId, t.occurredAt.desc().nullsFirst()),
  ],
);
```

索引細節：

| 決定 | 理由 |
| --- | --- |
| `DESC NULLS FIRST` | 與查詢的 `ORDER BY … DESC`（Postgres 預設 `NULLS FIRST`）完全一致，順向掃描即可，不多一次排序 |
| `occurred_idx` 帶 `id` | 列表排序是 `occurred_at DESC, id DESC`，同一時間點的紀錄也由索引決定先後 |
| `action` 用 `text_pattern_ops` | 預設 collation 下 `LIKE 'role.%'` 無法走 btree；pattern ops 同時支援等值與前綴 |
| 冷表 `changes` / `metadata` 用 `lz4` 壓縮 | 冷資料讀得少、存得久；lz4 的壓縮與解壓都比預設 pglz 快 |

**沒有外鍵指向 `users`**：使用者被硬刪除時稽核紀錄必須留著。`actor_id` 只是
一個值，不是關聯。

### 2.9 `system_settings`（系統設定的覆寫值）

`key`（text PK）、`value`（jsonb，純量）、`updated_at`、`updated_by`（→ `users`，`ON DELETE SET NULL`）。
只存覆寫值，沒有列的 key 用程式碼裡的預設值；定義、範圍與快取見 [`12-settings.md`](./12-settings.md)。

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

-- 熱表：不可改；只有「冷表已有一模一樣副本」的列可以刪（搬移用）
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard_delete();

-- 冷表：不可改、不可刪
CREATE TRIGGER audit_logs_archive_no_update BEFORE UPDATE ON audit_logs_archive
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_archive_no_delete BEFORE DELETE ON audit_logs_archive
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
```

`audit_logs_guard_delete()` 比對冷表同 `id` 那一列的 **所有欄位**
（`IS NOT DISTINCT FROM`），不一致就 `RAISE`。所以「先在冷表塞一筆假副本，再刪熱表」
這種竄改也會被擋下——任何從熱表消失的紀錄，冷表都有原封不動的一份。
完整 SQL 見 `db/migrations/0001_functions_and_triggers.sql`。

另外，應用程式使用的 DB role 只授予 `INSERT, SELECT`（冷表只有 `SELECT`）：

```sql
REVOKE UPDATE, DELETE ON audit_logs FROM b2b_system_app;
REVOKE INSERT, UPDATE, DELETE ON audit_logs_archive FROM b2b_system_app;
```

> **熱 → 冷搬移** 與 **冷表的保留期清理** 都由另一個具備 `DELETE` 權限的維運
> role 執行（見 §7 與 [`06-audit-log.md`](./06-audit-log.md) §8）。

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

### 5.2 兩條 migration 線

```
db/migrations/                          租戶 DB（每個租戶都跑；schema 在 db/schema/，drizzle.config.ts）
├── 0000_baseline.sql                   drizzle-kit 產生（開頭手動加上 pg_trgm）
├── 0001_functions_and_triggers.sql     手寫（drizzle-kit generate --custom）：protect_system_roles、
│                                       audit append-only 與冷熱分層、set_updated_at 的各表 trigger
├── 0002_system_settings.sql
├── 0006_roles_and_search.sql           角色名稱不分大小寫唯一（含既有同名的改名修補）、users 關鍵字的 trigram 索引、
│                                       protect_system_roles 也擋軟刪除
└── …                                   之後的變更接著編號
db/platform/migrations/                 平台 DB（schema 在 db/platform/schema/，drizzle.platform.config.ts）
├── 0000_baseline.sql                   tenants、tenant_domains、oidc_payloads
└── 0001_functions_and_triggers.sql     tenants 的 updated_at
```

產生 migration：租戶 DB `pnpm db:generate`；平台 DB `pnpm --filter @b2b-system/api exec drizzle-kit generate --config drizzle.platform.config.ts`。

2026-09-29 移除工作區、分出平台 DB 時重新建立了基準點（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D20），
當時還沒有正式環境資料。既有的開發資料庫要重建：`.env` 改用 `PLATFORM_DATABASE_URL`、`DEFAULT_TENANT_*`（見 `.env.example`），再 `pnpm db:migrate`；
預設租戶的 database 若留著舊的 migration 紀錄，刪掉重建後再 `pnpm db:seed`（[`../05-tenancy.md`](../05-tenancy.md) §8）。
新增權限不需要資料 migration：seed 會 upsert 權限目錄；已存在的系統角色要補新權限時，再寫一支手寫 migration。

### 5.3 啟動時檢查每個租戶的版本（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D14）

`pnpm db:migrate` 先跑平台 DB，再依序跑每個 `active` 租戶；單一租戶失敗不影響其他租戶，最後列出失敗的租戶並以非零結束。
api 不自己跑 migration，而是比對版本（`core/tenant/tenant-schema.ts`）：

| 情況 | 行為 |
| --- | --- |
| 租戶 DB 的最後一筆套用紀錄（`drizzle.__drizzle_migrations.created_at`）等於程式的 journal 最新的 `when` | 照常服務；結果沿用到連線字串改變為止 |
| 比程式新（滾動部署時的舊執行個體、程式回滾） | 照常服務並記 warn——所以 migration 必須對上一版程式相容（§5.1「破壞性變更拆成兩次部署」） |
| 落後、或從沒跑過 migration | 該租戶回 `503 TENANT_UNAVAILABLE`（HTTP、WebSocket、背景工作都是），其他租戶照常；每 30 秒重新檢查，補跑 `db:migrate` 後不必重啟 |
| 檢查失敗（DB 連不上） | 這次回 503，不沿用結果，下一次進入就重試 |

檢查在 `Tenancy.enter()`：啟動時（`onApplicationBootstrap`）逐一檢查每個 `active` 租戶並把落後的列在 error log，
之後登記的租戶在第一次進入時檢查。啟動不會因為某個租戶落後而失敗。平台 DB 由部署流程保證先 migrate（prod compose 的 `migrate` 服務）。

---

## 6. 連線

資料庫分兩種（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D1）：

| | 內容 | 連線 | DI token |
| --- | --- | --- | --- |
| 平台 DB（一個） | `tenants`、`tenant_domains`、`oidc_payloads`、pg-boss | `PLATFORM_DATABASE_URL`；`DatabaseModule` 建一個連線池 | `PLATFORM_DB`（`PlatformDatabase`） |
| 租戶 DB（每租戶一個） | 其餘所有業務表 | 連線字串以 `TENANT_SECRET_KEY` 加密存在 `tenants`；`core/tenant` 的 `Tenancy` 在第一次用到時建立小連線池（`TENANT_POOL_MAX`，閒置 60 秒關閉） | `TENANT_DB`（`Database`） |

- **`TENANT_DB` 永遠指向「目前的租戶」**：它是一個 Proxy，每次存取都轉到目前租戶脈絡（`AsyncLocalStorage`）的 database。
  repository 照常 `@Inject(TENANT_DB) private readonly db: Database`、`withTransaction(this.db, …)`，不必知道有多個租戶。
- **沒有租戶脈絡時存取 `TENANT_DB` 拋 `TENANT_NOT_FOUND`**，不會退回任何預設 database。
- 租戶脈絡的來源：HTTP 由 `TenantMiddleware` 依請求的網域決定；WebSocket 由 gateway 依 handshake 的網域決定；
  背景工作依工作的 `tenantId`（[`10-jobs.md`](./10-jobs.md) §1.1）；啟動時的初始化用 `Tenancy.forEachActive()`。
  直接呼叫 service 的測試用 `test/tenant.ts` 的 `inTestTenant()`。
- `withTransaction` 開的交易可以登記 `afterCommit(tx, hook)`，提交後才執行（背景工作的 outbox 用它）。
- 關閉時平台連線池與每個租戶的連線池都 `client.end({ timeout: 5 })`。

### 6.1 腳本

`db:migrate`、`db:seed`、`db:reset`、`db:archive-audit-logs` 走遍平台 DB 登記的每個租戶（`db/client.ts` 的 `forEachScriptTenant`）；
`db:seed:dev`、`db:seed:e2e` 只跑 `SEED_TENANT`（預設 `DEFAULT_TENANT_CODE`）。`db:migrate` 先跑平台 DB，
設定了 `DEFAULT_TENANT_DATABASE_URL` 時登記預設租戶（`DEFAULT_TENANT_CODE`、`DEFAULT_TENANT_DOMAINS`），
資料庫不存在時嘗試建立；單一租戶失敗不影響其他租戶，結束時列出失敗的租戶並以非零結束。

---

## 7. 稽核日誌的成長

稽核分成熱表 `audit_logs`（最近 90 天）與冷表 `audit_logs_archive`（更早），
每天由背景工作 `auditLog.archive`（[`10-jobs.md`](./10-jobs.md)；手動補跑用 `pnpm db:archive-audit-logs`）
呼叫 `archive_audit_logs(cutoff, batch_size)` 搬移；函式是 `SECURITY DEFINER`（`0001_functions_and_triggers.sql`，[`06-audit-log.md`](./06-audit-log.md) §8）：

```sql
-- 一次搬一批最舊的；呼叫端重複呼叫到回傳值 < batch_size 為止
SELECT archive_audit_logs(now() - interval '90 days', 5000);
```

函式內依序做「鎖定一批 id（`FOR UPDATE SKIP LOCKED`）→ 複製進冷表 → 從熱表刪除」，
每次呼叫是一個短交易。刪除會經過 §3.2 的 guard trigger，確認冷表已有完整副本。

分層的好處：

- 熱表只有 90 天的量，四個索引都小到能常駐記憶體；寫入與預設查詢只碰熱表。
- 冷表的量隨保留期成長，但只在查詢範圍早於 90 天時才被讀到（見 `06-audit-log.md` §7.2）。

冷表超過約 1000 萬列時，再把冷表改成按月分區：

```sql
CREATE TABLE audit_logs_archive (...) PARTITION BY RANGE (occurred_at);
CREATE TABLE audit_logs_archive_2026_09 PARTITION OF audit_logs_archive
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

屆時保留期清理變成 `DROP TABLE audit_logs_archive_2025_09`（瞬間完成、不產生
bloat），而不是一個會鎖表數分鐘的大 `DELETE`。索引全部以 `occurred_at` 結尾，
改造時不需要改查詢。

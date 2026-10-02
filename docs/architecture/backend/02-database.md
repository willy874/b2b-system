# 後端 02 — 資料庫

## 1. 慣例

| 對象         | 慣例                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| 表名         | 複數 snake_case：`users`、`relation_tuples`                              |
| 欄位         | snake_case：`created_at`、`token_version`                                |
| 主鍵         | `uuid`，`DEFAULT gen_random_uuid()`（`audit_logs` 例外，用 `bigserial`） |
| 時間         | `timestamptz`，一律存 UTC                                                |
| 布林         | `NOT NULL DEFAULT false`，不允許三態                                     |
| 軟刪除       | `deleted_at timestamptz`，唯一索引都帶 `WHERE deleted_at IS NULL`；查詢條件一律用 `notDeleted(table)`（見下方） |
| 連帶的軟刪除 | 一次操作連帶刪除多列（遞迴刪除資料夾）時帶同一個 `deletion_id uuid`，還原時只還原同一批（[ADR-0025](../../adr/0025-entity-revisions.md) D5；目前 `files`、`file_folders`） |
| Drizzle 變數 | camelCase 複數：`relationTuples`                                         |
| 列舉         | Postgres `enum` 型別（不是 `text` + `CHECK`），因為它會出現在 OpenAPI；例外見下方 |

**列舉的例外：多型關聯的類型欄位用 `text` ＋ 程式常數**（[ADR-0025](../../adr/0025-entity-revisions.md) D7）。
`resource_type`（`audit_logs`、`revisions`、回收桶、標籤／留言）與 `relation_tuples.object_type`／`subject_type` 這類
「指向哪一種資源」的欄位，每新增一種資源就要多一個值；用 enum 就得每次 `ALTER TYPE … ADD VALUE`，而且這個語句不能與使用新值的語句放在同一個交易。
值集中在程式的常數（camelCase，與稽核、關係圖同一組字串），DTO 以同一份常數產生 `z.enum`，OpenAPI 與 SDK 照樣有型別。
一般欄位的狀態、種類（例如 `users.status`）仍用 enum。

**軟刪除的查詢條件**（[ADR-0025](../../adr/0025-entity-revisions.md) D8）：`db/schema/soft-delete.ts` 的 `notDeleted(table)`
（＝`isNull(table.deletedAt)`，也接受 `alias()`），平台 DB 的表從 `@/db/platform/schema` 取得同一個函式。
ADR 寫的位置是 `db/soft-delete.ts`；實作放在 `db/schema/` 底下，因為 `isActiveRole()`（`db/schema/roles.ts`）要用它，
而 `db/schema/` 只依賴同層（[`conventions/07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §3.2）。

| 情境 | 寫法 |
| --- | --- |
| 一般查詢：只看未刪除的列 | `.where(and(eq(users.id, id), notDeleted(users)))` |
| SQL 樣板裡引用 Drizzle 的表 | `` sql`… AND ${notDeleted(users)}` `` |
| 手寫的別名、遞迴 CTE（無法呼叫函式） | `u.deleted_at IS NULL /* notDeleted */`：同一行必須帶這個註解 |
| **故意** 讀已刪除的列（回收桶、還原、永久刪除） | `isDeleted(table)`（＝`isNotNull`），讀的人一眼看出不是漏了條件 |
| 唯一值衝突（還原前找佔用者） | 照一般查詢寫 `notDeleted(...)`：佔用者一定是未刪除的列 |

- 🔒 `src/__tests__/soft-delete-scan.spec.ts` 掃 `modules/`、`core/`：出現 `isNull(<x>.deletedAt)`、`${x.deletedAt} IS [NOT] NULL`
  或沒有標註的 `deleted_at IS NULL` 就失敗。`db/schema` 的 partial unique index 不在掃描範圍。
- **不做預設排除**：Drizzle 沒有 default scope，自己包一層會讓故意讀已刪除資料的查詢變得隱晦；每個查詢自己寫條件。
- `isActiveRole()` 是 `notDeleted(roles)` 的別名，既有的呼叫照用。

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
    // human | service：服務帳號是不登入的非人類帳號（ADR-0027 D1；查人的地方加 isHumanUser()）
    kind: userKind("kind").notNull().default("human"),

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

    // 樂觀鎖：可編輯的欄位每次寫入遞增；登入計數、鎖定、密碼、token_version 不遞增（03-api-conventions.md §11）
    version: integer("version").notNull().default(1),

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
    // 樂觀鎖：名稱與說明每次寫入遞增；持有者與權限鍵（relation_tuples）的寫入不遞增
    version: integer("version").notNull().default(1),

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

/** 還有效（未軟刪除）的角色＝notDeleted(roles) 的別名（§1）。 */
export function isActiveRole(): SQL {
  return notDeleted(roles);
}
```

`roles` 被 user、role、permission、file 多個模組 join；「有效的角色」集中在 `isActiveRole()`，
軟刪除的語意之後改了（例如加上停用狀態）只改一處。`core/authz` 的遞迴 CTE 是手寫 SQL，同一個條件寫在那裡並註明。

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
連帶處理 `relation_tuples` 上以它為關係的邊（`tenant:self#<key>@role:<id>#holder`）。

### 2.4 `user_roles`、2.5 `role_permissions`（已刪除）

角色的持有者與角色的權限鍵只存在 `relation_tuples`（§2.10）。兩張舊表的對照：

| 舊表的一列 | 現在的邊 |
| --- | --- |
| `user_roles(u, r)` | `role:<r>#holder@user:<u>` |
| `role_permissions(r, p)` | `tenant:self#<p 的 key>@role:<r>#holder` |

兩張表與 `resource_grants`（[`09-file.md`](./09-file.md)）、migration 0008 的同步 trigger，依 §5.1「破壞性變更拆成兩次部署」
在 G3a 之後的下一次部署（G3b，[ADR-0024](../../adr/0024-relationship-based-access-control.md)）以 migration 0010 一起刪除，不可回退。

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

### 2.10 `relation_tuples`（關係圖的邊）

權限解析的資料來源（[ADR-0024](../../adr/0024-relationship-based-access-control.md)、[`../../rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §6）。
一列是一條 `物件#關係@主體`：

| 欄位 | 說明 |
| --- | --- |
| `object_type` / `object_id` | `role`、`tenant`（id 固定 `self`）、`fileFolder`…；id 是 text（租戶節點 `self`、萬用字元 `*`） |
| `relation` | `holder`、權限鍵（`role:update`）、`superAdmin`、資料夾等級（`editor`）… |
| `subject_type` / `subject_id` / `subject_relation` | 節點本身（`subject_relation = ''`，不能是 NULL，否則唯一索引擋不住重複）、節點的關係（`role:<id>#holder`）或萬用字元（`user:*`） |
| `expires_at` | null ＝ 不過期；過期的邊在解析時以 app 端的時間忽略 |
| `created_at` / `created_by` | `created_by` → `users`（`ON DELETE SET NULL`） |

索引：六欄唯一（`relation_tuples_key`）、`(subject_type, subject_id, subject_relation)`（主體閉包往外走）、
`(object_type, object_id, relation)`（從物件往回查）。多型關聯沒有外鍵，解析時 join 未刪除的節點（例：主體閉包只走未刪除的角色）。

**G3a 起由程式直接讀寫**：邊的形狀與查詢條件只寫在 `db/schema/relation-tuples.ts`（`roleHolderTuple`、`rolePermissionTuple`、
`superAdminTuple`、`isRoleHolderTuple()`、`isRolePermissionTuple()`、`ROLE_HOLDER_RELATION` 等常數），repository、seed、測試共用。

| 邊 | 意思 | 寫入者 |
| --- | --- | --- |
| `role:<r>#holder@user:<u>` | 使用者持有角色 | `UserRepository`、`RoleRepository` |
| `tenant:self#<key>@role:<r>#holder` | 角色帶的權限鍵 | `RoleRepository` |
| `tenant:self#superAdmin@role:<r>#holder` | super-admin 角色（它沒有權限鍵的邊） | seed（`seedRoles` → `ensureSuperAdminTuple`，冪等） |
| `fileFolder:<id>#<level>@(role:<r>#holder \| user:<u> \| user:*)` | 資料夾授權 | `FileFolderGrantRepository`（[`09-file.md`](./09-file.md)） |
| `group:<g>#member@(user:<u> \| group:<h>#member)` | 群組的成員；巢狀時主體是另一個群組的成員（§2.14） | `GroupRepository` |
| `role:<r>#holder@group:<g>#member` | 群組持有角色（不能是 super-admin，ADR-0024 D12） | `GroupRepository` |

- 刪除角色：只軟刪除角色列，**持有者邊、權限鍵邊、它作為主體的資料夾授權都留著**（ADR-0025 D2，R3 起）。
  已刪除角色的持有者邊是 **休眠的邊**：主體閉包、使用者的角色（`HELD_ROLE`）、依角色篩選使用者都 join 未刪除的角色而略過它們，
  角色還原時原本的持有者自動回來；`PUT /users/:id/roles` 只刪未刪除角色的邊，不會清掉它們。
  以角色為起點的查詢（`countUsers`、`listUsers`、`findUserIdsByRole`…）不看角色是否刪除，呼叫端先確認角色的狀態。
  永久刪除角色（`trash.purge`）時才把以它為物件與主體的邊全部刪掉（[`13-trash.md`](./13-trash.md) §6）。
  R3 之前的版本刪除角色時會刪持有者邊，那些角色還原後沒有持有者。
- 「每個主體在一個資料夾只有一個等級」不是 DB 的唯一索引（六欄唯一包含等級），由 `FileFolderGrantRepository.set` 先刪後插維持；
  授權的寫入經 `FileFolderTree.write` 序列化。

G1～G2 期間由舊表上的 trigger 同步寫入這張表（migration 0008，並回填既有資料）；trigger、它們的函式與舊表已在 G3b 刪除（migration 0010）。

### 2.11 `authz_revision`（關係圖的版本號）

單列（`id boolean PK DEFAULT true`、`CHECK (id)`）、`revision bigint`。migration 0009（表由 drizzle-kit 產生；初始列與 trigger 手寫）：
`relation_tuples` 上的 **語句層級** trigger（`AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE … FOR EACH STATEMENT`）
在同一個交易裡讓 `revision` +1。

- 寫入者在這一列的鎖上排隊，所以 **提交順序＝版本順序**。
- 一條語句寫多列只 +1；沒影響任何列的語句也 +1（只是多一次失效）。
- 程式在交易提交後讀它，連同租戶代碼在平台 DB 廣播（`core/authz/authz.revision.ts`，[`05-rbac.md`](./05-rbac.md) §5.1）。
- `roles.deleted_at` 改變（刪除、還原角色）也 +1：migration 0012 的列層級 trigger（`AFTER UPDATE OF deleted_at … WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)`，
  同一個 `authz_revision_bump()`）。R3 起刪除與還原角色不寫 `relation_tuples`，但主體閉包會排除已刪除的角色，等於關係圖變了。
- `groups.deleted_at` 改變同理：migration 0017 的同形 trigger（§2.14）。

### 2.12 `revisions`（版本歷史）

選擇性加入的實體每次寫入後的整份快照（[ADR-0025](../../adr/0025-entity-revisions.md) D1；完整說明見 [`14-revisions.md`](./14-revisions.md) §2）。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `resource_type` | `text` | `RESOURCE_TYPE` 的值（§1「列舉的例外」） |
| `resource_id` | `uuid` | 多型，沒有外鍵；永久刪除實體時由擁有者一起刪 |
| `version` | `integer` | 每個資源自己的流水號，與實體的 `version`（樂觀鎖）無關 |
| `snapshot` | `jsonb NULL` | 寫入之後的狀態；超過 1 MiB 時是 null |
| `actor_id` | `uuid NULL` → `users.id` `ON DELETE SET NULL` | 系統寫入是 null |
| `created_at` | `timestamptz` | |

`UNIQUE (resource_type, resource_id, version)`、`INDEX (created_at)`。沒有 `updated_at`、`deleted_at`：版本寫入後不改，只會被保留清理或永久刪除刪掉。

### 2.13 `notifications`（站內通知）

每位收件人一筆（[ADR-0026](../../adr/0026-notification-center.md) D1；完整說明見 [`15-notification.md`](./15-notification.md) §2）。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `recipient_id` | `uuid` → `users.id` `ON DELETE CASCADE` | 收件人；永久刪除使用者時通知一起刪掉 |
| `type` | `text` | `<模組>.<事件>`；text ＋ 擁有者模組的常數（§1「列舉的例外」） |
| `params` | `jsonb` | 組句子用的名稱快照 |
| `link` | `jsonb NULL` | `{ route, params }`：前端的 route id ＋ 參數 |
| `actor_id` | `uuid NULL` → `users.id` `ON DELETE SET NULL` | 觸發的人；null＝系統 |
| `read_at` | `timestamptz NULL` | null＝未讀 |
| `created_at` | `timestamptz` | |

`INDEX (recipient_id, created_at, id)`（列表、keyset、每人上限的清理）、`INDEX (recipient_id, created_at, id) WHERE read_at IS NULL`（未讀數與未讀列表）、
`INDEX (read_at) WHERE read_at IS NOT NULL`（已讀過期的清理）。沒有 `updated_at`、`deleted_at`：除了 `read_at` 不改，清除是硬刪除。

### 2.14 `groups`（群組）

純分組（[ADR-0024](../../adr/0024-relationship-based-access-control.md) D11、D12）：只存名稱與說明，成員與持有的角色都是 `relation_tuples` 的邊（§2.10），不另開 `group_members`。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `name` | `text` | 不分大小寫唯一（`groups_name_key`：`lower(name) WHERE deleted_at IS NULL`） |
| `description` | `text NULL` | |
| `version` | `integer` | 樂觀鎖；成員與持有角色的寫入不遞增（ADR-0025 D3） |
| `created_at` / `created_by` / `updated_at` / `updated_by` | | `updated_at` 由 trigger 維護（§3.3） |
| `deleted_at` | `timestamptz NULL` | 軟刪除；成員與持有角色的邊保留（休眠），主體閉包略過已刪除的群組，還原時一起回來 |

「有效的群組」集中在 `isActiveGroup()`（＝`notDeleted(groups)`）；`core/authz` 與 `GroupRepository` 的遞迴 CTE 是手寫 SQL，同一個條件寫在那裡並註明。
migration 0017 手寫兩個 trigger：`deleted_at` 改變時 `authz_revision` +1（§2.11）、`updated_at`。

### 2.15 `api_tokens`（API token）與服務帳號

服務帳號是 `users` 的一列（`kind = 'service'`，[ADR-0027](../../adr/0027-api-tokens-external-api.md) D1）：沒有密碼、`email` 是不可投遞的
`svc-<id>@service.invalid`。使用者列表、人數、最後一位 super-admin（I8）、登入與忘記密碼的 email 查詢、外部 IdP 的自動連結、
個人資料夾、以權限找通知的收件人都只看人：查詢加上 `isHumanUser()`（`db/schema/users.ts`，與 `notDeleted()` 一樣組合使用）。
刪除的服務帳號不在回收桶列出、不能還原，保留期滿後與使用者一起由 `trash.purge` 清除。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `uuid` PK | token 的 `<tokenId>` 段是它的 base62 |
| `user_id` | `uuid` FK → `users`（`ON DELETE CASCADE`） | 擁有者：本人（個人 token）或服務帳號 |
| `name` | `text` | |
| `prefix` | `text` | 開頭到 secret 的前 4 碼，管理頁辨認用 |
| `secret_hash` | `text` | secret 的 SHA-256（hex）；secret 是 256 位元的隨機值，不需要慢雜湊 |
| `scopes` | `text[] NULL` | 限縮到的權限鍵；null＝跟著帳號（D3） |
| `account_version` | `integer` | 建立當時帳號的 `token_version`；不相等就失效（D5） |
| `expires_at` | `timestamptz` | 必填；個人最多 90 天、服務帳號最多 365 天（系統設定可調短，D8） |
| `last_used_at` | `timestamptz NULL` | 由對外 API 每分鐘批次更新（T2） |
| `revoked_at` / `revoked_by` | | 撤銷 |
| `created_at` / `created_by` | | |

索引：`(user_id, created_at desc)`（管理頁的列表）、`(user_id) WHERE revoked_at IS NULL`（有效 token 數的上限）。

### 2.16 `webhook_subscriptions`、`webhook_events`、`webhook_deliveries`（Webhook）

欄位、索引與保留見 [`17-webhook.md`](./17-webhook.md) §2（[ADR-0030](../../adr/0030-webhooks.md)）。訂閱是設定、硬刪除；事件與投遞紀錄保留 30 天，
刪除事件時投遞紀錄 CASCADE。這三張表沒有 `deleted_at`，不經 `notDeleted()`。

### 2.17 `tags`、`resource_tags`（標籤）

欄位、約束與篩選條件 `hasAnyTag()` 見 [`18-tag.md`](./18-tag.md) §2（[ADR-0032](../../adr/0032-tags.md)）。`resource_tags` 是多型關聯（`resource_type` ＋ `resource_id`），
沒有指向資源的外鍵：資源永久刪除時由擁有者清掉（[`13-trash.md`](./13-trash.md)）。

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
-- groups 的在 migration 0017
```

---

## 4. 核心查詢

### 4.1 使用者的權限集合（最熱的查詢）

由關係圖解析（`core/authz/authz.repository.ts`）：一條遞迴 CTE 從 `user:<id>`、`user:*` 沿 `role#holder`
走出主體閉包（只走未刪除的角色、深度上限 8，多人一次查），再一條查詢取這些主體在 `tenant:self` 上的邊，
閉包（權限依賴樹）在記憶體算。super-admin 是 `tenant:self#superAdmin` 這條邊，同一次查詢帶回，不另外往返。

索引：主體閉包走 `(subject_type, subject_id, subject_relation)`；租戶節點上的邊走 `(object_type, object_id, relation)`。

### 4.2 是否為 super-admin

見 §4.1。`UserRepository.hasRoleSlug`（`assertCanManage` 用，不經快取）是持有者邊 ⋈ `roles` 以 slug 判斷。

### 4.3 角色的持有者

```ts
async findUserIdsByRole(roleId: string): Promise<string[]> {
  const rows = await this.db.select({ userId: relationTuples.subjectId })
    .from(relationTuples)
    .where(and(isRoleHolderTuple(), eq(relationTuples.objectId, roleId)));
  return rows.map((r) => r.userId);
}
```

靠 `(object_type, object_id, relation)` 索引。只用來推播（`RESOURCE_CHANGED` 的 `affectedUserIds`）；
權限快取的失效以整個租戶為單位，不需要它（[`05-rbac.md`](./05-rbac.md) §5.1）。

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
  // 持有角色的邊：role:<r>#holder@user:<users.id>（多型 id 是 text，uuid 那邊轉成 text）
  .leftJoin(relationTuples, and(isRoleHolderTuple(), eq(relationTuples.subjectId, sql`${users.id}::text`)))
  .leftJoin(roles, and(eq(sql`${roles.id}::text`, relationTuples.objectId), isActiveRole()))
  .where(and(notDeleted(users), ...filters))
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
├── 0007_relation_tuples.sql            關係圖的邊（§2.10）
├── 0008_relation_tuples_mirror.sql     手寫：回填、舊表 → relation_tuples 的同步 trigger（G3b 刪除）
├── 0009_authz_revision.sql             authz_revision 與遞增 trigger（§2.11）
├── 0010_drop_legacy_authz_tables.sql   G3b：刪 0008 的 trigger 與函式、user_roles、role_permissions、resource_grants 與三個 enum
├── 0011_entity_version.sql             users.version、roles.version（樂觀鎖，ADR-0025 R1；純加法）
├── 0012_roles_authz_revision.sql       手寫：roles.deleted_at 改變時 authz_revision +1（§2.11，ADR-0025 R3）
├── 0013_file_deletion_id.sql           files.deletion_id、file_folders.deletion_id ＋ 只涵蓋已刪除列的索引
│                                       （一次刪除操作的識別，ADR-0025 D5、R4a；純加法，既有的已刪除列是 null）
├── 0014_revisions.sql                  revisions 表（§2.12）＋ 手寫：每個既有角色的基準版本（第 1 版，actor null；
│                                       ADR-0025 R5、14-revisions.md §4.2；純加法）
├── 0015_notifications.sql              notifications 表與三個索引（§2.13，ADR-0026 N1；純加法）
├── 0016_groups.sql                     groups 表（§2.14，ADR-0024 G4a；純加法）
├── 0017_groups_triggers.sql            手寫：groups.deleted_at 改變時 authz_revision +1、updated_at（§2.11、§3.3）
├── 0018_groups_system_role_permissions.sql  手寫：既有租戶的 admin 補 group:*、auditor 補 group:read（§6 的規則）
├── 0019_authz_explain_system_roles.sql     手寫：既有租戶的 admin、auditor 補 authz:explain（§6 的規則）
├── 0020_notification_policies.sql      notification_policies 表（ADR-0028；純加法）
├── 0021_notification_preferences.sql   個人通知設定（ADR-0028 E3；純加法）
├── 0022_api_tokens.sql                 users.kind、api_tokens 表（§2.15，ADR-0027 T1；純加法）
├── 0023_service_account_system_roles.sql   手寫：既有租戶的 admin 補 serviceAccount:*、auditor 補 serviceAccount:read
├── 0024_webhooks.sql                   webhook_subscriptions、webhook_events、webhook_deliveries（§2.16，ADR-0030；純加法）
├── 0025_webhook_system_roles.sql       手寫：既有租戶的 admin 補 webhook:*、auditor 補 webhook:read
├── 0026_tags.sql                       tags、resource_tags（§2.17，ADR-0032；純加法）
├── 0027_tag_system_roles.sql           手寫：既有租戶的 admin 補 tag:*
├── 0028_notification_overview_idx.sql 通知總覽的兩個索引（ADR-0031 D1；純加法）
├── 0029_notification_read_system_roles.sql  手寫：既有租戶的 admin 補 notification:read
├── 0030_announcements.sql              announcements、announcement_dispatches、notifications.source_id（ADR-0031；純加法）
├── 0031_announcement_system_roles.sql  手寫：既有租戶的 admin 補 announcement:*、auditor 補 read
├── 0032_announcement_event_triggers.sql  公告的事件點：trigger_subject_id 與兩種唯一索引、事件查詢索引（純加法，唯一索引改為部分索引）
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
| 平台 DB（一個） | `tenants`、`tenant_domains`、`oidc_payloads`、pg-boss；程序之間的失效廣播（`LISTEN`／`NOTIFY`，`core/broadcast`） | `PLATFORM_DATABASE_URL`；`DatabaseModule` 建一個連線池 | `PLATFORM_DB`（`PlatformDatabase`）；底層的 postgres.js client 是 `PLATFORM_SQL`（`BroadcastService` 用） |
| 租戶 DB（每租戶一個） | 其餘所有業務表 | 連線字串以 `TENANT_SECRET_KEY` 加密存在 `tenants`；`core/tenant` 的 `Tenancy` 在第一次用到時建立小連線池（`TENANT_POOL_MAX`，閒置 `TENANT_POOL_IDLE_TIMEOUT` 秒關閉） | `TENANT_DB`（`Database`） |

- **`TENANT_DB` 永遠指向「目前的租戶」**：它是一個 Proxy，每次存取都轉到目前租戶脈絡（`AsyncLocalStorage`）的 database。
  repository 照常 `@Inject(TENANT_DB) private readonly db: Database`、`withTransaction(this.db, …)`，不必知道有多個租戶。
- **沒有租戶脈絡時存取 `TENANT_DB` 拋 `TENANT_NOT_FOUND`**，不會退回任何預設 database。
  例外是 Nest 啟動時對每個 provider 的探測（`then`、`constructor`、生命週期 hook 名稱），一律回 `undefined`
  （`core/tenant/tenant-db.provider.ts` 的 `PROBES`）；Nest 升版後若啟動時出現 `TENANT_NOT_FOUND`，先看是不是多了新的探測。
- 租戶脈絡的來源：HTTP 由 `TenantMiddleware` 依請求的網域決定；WebSocket 由 gateway 依 handshake 的網域決定；
  背景工作依工作的 `tenantId`（[`10-jobs.md`](./10-jobs.md) §1.1）；啟動時的初始化用 `Tenancy.forEachActive()`。
  直接呼叫 service 的測試用 `test/tenant.ts` 的 `inTestTenant()`。
- `withTransaction` 開的交易可以登記 `afterCommit(tx, hook)`，提交後才執行（背景工作的 outbox 用它）。
- 關閉時平台連線池與每個租戶的連線池都 `client.end({ timeout: 5 })`。

### 6.2 連線預算與逾時

postgres 的連線是有限資源（`max_connections`，每條約數 MB 記憶體）。api 程序會開的連線：

| 連線池 | 上限 | 環境變數 |
| --- | --- | --- |
| 平台 DB | 10（production）／3（其他） | `PLATFORM_POOL_MAX` |
| pg-boss（平台 DB） | 4 | —（`core/jobs/job-queue.ts`） |
| 廣播的監聽（平台 DB） | 1（postgres.js 的 `listen` 另開一條常駐連線） | —（`core/broadcast`） |
| 每個租戶 | 10，閒置 30 秒關閉 | `TENANT_POOL_MAX`、`TENANT_POOL_IDLE_TIMEOUT` |

**預算**：`(平台池 ＋ 4 ＋ 1 ＋ 同時活躍的租戶數 × TENANT_POOL_MAX) × api 程序數 ＋ migrate／腳本 ＜ max_connections − superuser_reserved_connections（3）`。
對外 API（`external-api`，[`../06-external-api.md`](../06-external-api.md)）是另一個程序，同樣算進「api 程序數」，但它的池在 compose
另外設定（`EXTERNAL_TENANT_POOL_MAX` 預設 5、`EXTERNAL_PLATFORM_POOL_MAX` 預設 5）。

- 「同時活躍」是 `TENANT_POOL_IDLE_TIMEOUT` 內有請求或背景工作的租戶；租戶的池是按需建立連線，平常遠低於上限。
  `jobs.outboxSweep` 會進入每個 `active` 租戶，所以它的間隔（預設 10 分鐘）要遠大於閒置逾時，否則所有租戶的池永遠不會關。
- 估算（單一 api 程序、`max_connections=200`，compose 的預設）：15 ＋ 10 × N ＜ 197 → **約 18 個租戶同時滿載**。
  實際上一個租戶的穩態只用 1–3 條（1000 人、約 600 qps × 2–5 ms），尖峰才會用到 10 條；超過這個規模時在 postgres
  前面加 PgBouncer（transaction mode；只能用交易層級的 `pg_advisory_xact_lock`），或提高 `max_connections` 並加記憶體。
- 1000 人集中在一個租戶時，`TENANT_POOL_MAX` 是那個租戶的並行查詢上限：慢查詢會讓其他請求在池裡排隊。
  postgres.js 沒有「排隊逾時」，所以每條連線都設下面的逾時，讓一條失控的查詢不會一直佔住連線。

每條連線建立時以連線參數設定（`database.provider.ts` 的 `postgresOptionsOf`，平台與租戶的池都一樣；migration 與腳本不設）：

| 參數 | 預設 | 環境變數 | 超過時 |
| --- | --- | --- | --- |
| `statement_timeout` | 15 秒 | `DB_STATEMENT_TIMEOUT_MS`（0 = 不限制） | 該語句被取消（`57014`），請求回 500 |
| `idle_in_transaction_session_timeout` | 30 秒 | `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`（0 = 不限制） | postgres 結束該連線 |
| `connect_timeout` | 10 秒 | `DB_CONNECT_TIMEOUT` | 建立連線失敗 |

postgres 端的調校（`docker-compose.prod.yml` 的 `command`）：`max_connections`、`shared_buffers`（約記憶體 25%）、
`effective_cache_size`（約 75%）、`work_mem`、`pg_stat_statements`、`log_min_duration_statement=500`。

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

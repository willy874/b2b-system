# RBAC 01 — 領域模型

## 1. 模型選擇

採用 **NIST RBAC Level 1（Flat RBAC）** ＋ 兩項強化：

| 特性                               | 是否採用   | 說明                                                                        |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------- |
| User ↔ Role 多對多                 | ✅         | 一個使用者可持有多個角色                                                    |
| Role ↔ Permission 多對多           | ✅         | 權限是預先定義的目錄，不可由使用者自創                                      |
| 角色階層（Hierarchical RBAC）      | ❌         | 見 [ADR-0006](../adr/0006-flat-permission-scope.md)，用「複製角色」取代繼承 |
| 職責分離（SoD / Constrained RBAC） | ❌         | Phase 0 不做互斥角色                                                        |
| 資源作用域（Scoped / ABAC）        | ◐ 檔案     | 檔案管理器的資料夾層級授權，見 [`07-resource-grants.md`](./07-resource-grants.md)；其餘資源見 §7 延伸點 |
| **反提權**                         | ✅（強化） | 授權者不能授予自己沒有的權限                                                |
| **系統角色保護**                   | ✅（強化） | `is_system` 角色不可刪除／改名                                              |

> 「權限是目錄，不是自由文字」是這個模型最重要的性質。`permissions` 表的內容
> 由 seed 決定、隨程式碼版本演進，**不提供 API 建立權限**。這讓前端可以安全地
> 把權限鍵當成 enum 使用，也讓「某角色能做什麼」永遠是有限且可列舉的。

---

## 2. 實體關係圖

```
                    ┌──────────────────────┐
                    │        users         │
                    │──────────────────────│
                    │ id            uuid pk│
                    │ email         citext │◀── unique (where deleted_at is null)
                    │ username      citext │◀── unique (where deleted_at is null)
                    │ display_name  text   │
                    │ password_hash text   │
                    │ status        enum   │  active | inactive | pending | locked
                    │ token_version int    │  ← +1 即撤銷所有既存 access token
                    │ failed_login_count   │
                    │ locked_until  tstz   │
                    │ last_login_at tstz   │
                    │ mfa_enabled   bool   │  ← 預留，Phase 0 恆為 false
                    │ created_at/by        │
                    │ updated_at/by        │
                    │ deleted_at    tstz   │  ← 軟刪除
                    └──────────┬───────────┘
                               │ 1
                               │
                               │ N
                    ┌──────────▼───────────┐
                    │     user_roles       │
                    │──────────────────────│
                    │ user_id  uuid fk pk  │
                    │ role_id  uuid fk pk  │
                    │ granted_at    tstz   │
                    │ granted_by    uuid   │
                    └──────────┬───────────┘
                               │ N
                               │
                               │ 1
                    ┌──────────▼───────────┐
                    │        roles         │
                    │──────────────────────│
                    │ id            uuid pk│
                    │ slug          text   │◀── unique，穩定識別碼（程式碼參照用）
                    │ name          text   │◀── unique，顯示名稱（可改）
                    │ description   text   │
                    │ is_system     bool   │
                    │ created_at/by        │
                    │ updated_at/by        │
                    │ deleted_at    tstz   │
                    └──────────┬───────────┘
                               │ 1
                               │
                               │ N
                    ┌──────────▼───────────┐
                    │  role_permissions    │
                    │──────────────────────│
                    │ role_id       uuid pk│
                    │ permission_id uuid pk│
                    │ granted_at    tstz   │
                    │ granted_by    uuid   │
                    └──────────┬───────────┘
                               │ N
                               │
                               │ 1
                    ┌──────────▼───────────┐
                    │     permissions      │
                    │──────────────────────│
                    │ id            uuid pk│
                    │ key           text   │◀── unique，'role:update'
                    │ resource      text   │
                    │ action        text   │
                    │ name_i18n_key text   │  ← 顯示名稱的語系鍵
                    │ description   text   │
                    │ sort_order    int    │
                    └──────────────────────┘


  ┌──────────────────────┐          ┌────────────────────────────┐
  │   refresh_tokens     │          │        audit_logs          │
  │──────────────────────│          │────────────────────────────│
  │ id            uuid pk│          │ id              bigserial  │
  │ user_id       uuid fk│          │ occurred_at     tstz       │
  │ family_id     uuid   │◀─ 輪替鏈 │ actor_id        uuid null  │
  │ token_hash    text   │          │ actor_email     text       │ ← 快照，避免 join
  │ expires_at    tstz   │          │ action          text       │ 'role.update'
  │ used_at       tstz   │          │ resource_type   text       │ 'role'
  │ revoked_at    tstz   │          │ resource_id     text null  │
  │ revoked_reason text  │          │ result          enum       │ success | failure
  │ user_agent/ip        │          │ error_code      text null  │
  │ created_at    tstz   │          │ changes         jsonb null │ { before, after }
  └──────────────────────┘          │ metadata        jsonb null │ { ip, ua, requestId }
                                    └────────────────────────────┘
```

---

## 3. 實體說明

### 3.1 `users`

| 欄位                                  | 說明                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `email`                               | 型別 `citext`，大小寫不敏感唯一。登入識別碼                                         |
| `username`                            | 選填、唯一。供顯示與搜尋                                                            |
| `password_hash`                       | Argon2id。`pending` 狀態的使用者此欄為 `NULL`                                       |
| `status`                              | `active` / `inactive` / `pending` / `locked`。只有 `active` 可登入                  |
| `token_version`                       | 每次「停用／刪除／強制登出／改密碼」時 +1。JWT 內含 `ver`，驗簽後比對不符即視為失效 |
| `failed_login_count` / `locked_until` | 暴力破解防護                                                                        |
| `deleted_at`                          | 軟刪除。唯一索引都帶 `WHERE deleted_at IS NULL`，讓刪除後 email 可再用              |

**狀態機**

```
        建立（無密碼）
              │
              ▼
          ┌────────┐  設定密碼   ┌────────┐
          │pending │──────────▶ │ active │◀──────────┐
          └────────┘            └───┬────┘           │
                                    │                │ 解鎖 / 啟用
                       停用 ────────┤                │
                                    ▼                │
                                ┌──────────┐         │
                                │ inactive │─────────┤
                                └──────────┘         │
                    連續登入失敗   │                  │
                                  ▼                  │
                              ┌────────┐             │
                              │ locked │─────────────┘
                              └────────┘
```

### 3.2 `roles`

- `slug`：程式碼唯一參照的穩定鍵（`super-admin`、`admin`…）。**建立後不可變**。
- `name`：顯示名稱，可改，但在未刪除的角色中必須唯一。
- `is_system`：系統角色，受保護（見 §5）。

### 3.3 `permissions`

**只讀目錄。** 沒有 `POST /permissions`。新增權限的唯一途徑是：
改 `db/seeds/permissions.ts` → 跑 `pnpm db:seed`（冪等 upsert）→ 重新產生
`api-sdk` → 前端拿到新的 `PermissionKey` 值。

### 3.4 `refresh_tokens`

`family_id` 是輪替鏈的識別碼。一次登入開一條家族；每次續期新增一列、把舊列標
`used_at`。若收到一條 `used_at IS NOT NULL` 的 token → 判定為重用 → **撤銷整條家族**。

### 3.5 `audit_logs`

Append-only。`actor_email` 等欄位是寫入當下的快照，因此即使使用者之後被刪除，
稽核紀錄依然可讀，且查詢不需要 join。

### 3.6 `approval_requests`

需要管理員核准才生效的變更（第一個類型是使用者註冊）。申請人、審核者的名稱同樣是快照；
`private_payload`（註冊的密碼雜湊）永不回傳、審核後清空。欄位、約束與狀態機見
[`06-approval.md`](./06-approval.md)。

---

## 4. 不變條件（Invariants）

實作時必須以 DB 約束或交易保證，不能只靠應用層檢查。

| #   | 不變條件                                       | 強制方式                                             |
| --- | ---------------------------------------------- | ---------------------------------------------------- |
| I1  | `permissions.key` 全域唯一                     | `UNIQUE (key)`                                       |
| I2  | `permissions.key` = `resource                  |                                                      | ':' |     | action` | `CHECK` 約束 |
| I3  | 未刪除的 `roles.slug` / `roles.name` 唯一      | partial `UNIQUE INDEX ... WHERE deleted_at IS NULL`  |
| I4  | 未刪除的 `users.email` / `users.username` 唯一 | 同上                                                 |
| I5  | `user_roles` / `role_permissions` 無重複       | 複合主鍵                                             |
| I6  | 刪除角色時連帶刪除其指派與授權                 | `ON DELETE CASCADE`                                  |
| I7  | **系統角色不可刪除**                           | Service 層檢查 ＋ DB trigger（雙保險）               |
| I8  | **系統中永遠至少有一個可用的 super-admin**     | 刪除／停用最後一個 super-admin 時 Service 拒絕       |
| I9  | 使用者不能修改／刪除自己的帳號狀態與角色       | Service 層檢查（`actorId === targetId` → 403）       |
| I10 | 授予的權限必須存在於 `permissions`             | 外鍵                                                 |
| I11 | 反提權：授予的權限必須 ⊆ 操作者的權限集合      | Service 層檢查（super-admin 豁免）                   |
| I12 | `audit_logs` 不可 UPDATE / DELETE              | DB role 權限 ＋ `BEFORE UPDATE/DELETE` trigger raise |

---

## 5. 系統角色保護

`is_system = true` 的角色：

| 操作                      | super-admin                     | 其他系統角色（admin / auditor / member） |
| ------------------------- | ------------------------------- | ---------------------------------------- |
| 刪除                      | ❌ `ROLE_SYSTEM_PROTECTED`      | ❌ `ROLE_SYSTEM_PROTECTED`               |
| 改 `slug`                 | ❌                              | ❌                                       |
| 改 `name` / `description` | ❌                              | ✅                                       |
| 改權限                    | ❌ `ROLE_SUPER_ADMIN_IMMUTABLE` | ✅（仍受反提權限制）                     |
| 指派給使用者              | ✅                              | ✅                                       |
| 複製成新角色              | ✅（複本是一般角色）            | ✅                                       |

---

## 6. 權限解析

### 6.1 定義

使用者 `u` 的 **權限集合**：

```sql
SELECT DISTINCT p.key
FROM user_roles ur
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p        ON p.id = rp.permission_id
JOIN roles r              ON r.id = ur.role_id AND r.deleted_at IS NULL
WHERE ur.user_id = $1;
```

### 6.2 super-admin 旁路

若使用者持有 `slug = 'super-admin'` 的角色，權限集合視為 **全集**：
`PermissionsGuard` 直接放行，前端 `can()` 恆回 `true`。

實作上 `GET /auth/profile` 仍回傳完整的權限鍵陣列（把所有 `permissions.key`
都列出），讓前端不需要處理特例分支——**前端沒有「super admin」這個概念**，
只有「你持有哪些鍵」。

### 6.3 沒有 deny 規則

本模型 **只有 allow，沒有 deny**。兩個角色的權限一律取聯集。這是刻意的：
deny 規則會讓「為什麼這個人不能做 X」變成需要推理的問題。需要限制時，作法是
拆角色，而不是加否定規則。

---

## 7. 預留的延伸點

以下不在 Phase 0 實作，但結構上已經留好位置：

| 延伸                                   | 預留方式                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **資源作用域**（「只能編輯自己專案」） | 已由檔案資料夾先行實作：通用的 `resource_grants`（資源 × 對象 × 等級，沿上層鏈繼承），不改 `user_roles`。專案、關卡沿用同一張表，見 [`07-resource-grants.md`](./07-resource-grants.md) §10 |
| **角色階層**                           | 新增 `role_inherits (parent_id, child_id)`，解析時做遞迴 CTE                                                    |
| **條件式權限（ABAC）**                 | `role_permissions` 增加 `condition jsonb`，Guard 端加入條件評估器                                               |
| **多租戶**                             | 各表加 `tenant_id`，配合 Postgres Row Level Security                                                            |
| **MFA**                                | `users.mfa_enabled` / 新表 `user_mfa_secrets`                                                                   |
| **API Token / 服務帳號**               | 新增 `service_accounts` 表，同樣掛 `user_roles`（Subject 抽象化）                                               |

延伸時的相容性承諾：**權限鍵的字串格式不會變**，因此既有的
`@RequirePermissions('role:update')` 宣告與前端的 `can('role:update')` 都不需
要修改。

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
| **權限依賴樹**                     | ✅（強化） | 同資源的子能力與只指向 read 的依賴：持有一個鍵就持有它帶來的鍵（[`02-permission-catalog.md`](./02-permission-catalog.md) §9、[ADR-0024](../adr/0024-relationship-based-access-control.md) D6） |
| **系統角色保護**                   | ✅（強化） | `is_system` 角色不可刪除、不可改 `slug`（顯示名稱可改，見 §5）               |
| **儲存與解析：關係圖（ReBAC）**    | ✅         | 持有角色、角色的權限鍵、資料夾授權都是同一張 `relation_tuples` 上的邊，由同一個引擎解析（§6.4、[ADR-0024](../adr/0024-relationship-based-access-control.md)）。對外仍是上面這套 RBAC：權限鍵的格式、角色、指派的 API 都沒有變 |

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
                    │ 持有角色（邊）       │  relation_tuples：
                    │──────────────────────│  role:<r>#holder@user:<u>
                    │ created_at    tstz   │
                    │ created_by    uuid   │
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
                    │ 角色的權限鍵（邊）   │  relation_tuples：
                    │──────────────────────│  tenant:self#<key>@role:<r>#holder
                    │ created_at    tstz   │  （以 key 對應 permissions，沒有外鍵）
                    │ created_by    uuid   │
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
- `name`：顯示名稱，可改，但在未刪除的角色中必須唯一——**不分大小寫**（`Admin` 與 `admin` 不能並存），寫入前正規化成 Unicode NFC。
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
| I3  | 未刪除的 `roles.slug` / `roles.name` 唯一（name 不分大小寫） | partial `UNIQUE INDEX ... WHERE deleted_at IS NULL`（name 用 `lower(name)`） |
| I4  | 未刪除的 `users.email` / `users.username` 唯一 | 同上                                                 |
| I5  | 持有角色、角色的權限鍵無重複                   | `relation_tuples` 的六欄唯一索引                     |
| I6  | 刪除角色時連帶撤銷其指派                       | 角色軟刪除；持有者邊、權限鍵邊與資料夾授權都留著，解析與使用者端的讀取略過已刪除的角色（休眠的邊）。還原角色時原本的持有者自動回來；永久刪除時才刪掉所有邊（[ADR-0025](../adr/0025-entity-revisions.md) D2，[`13-trash.md`](../architecture/backend/13-trash.md) §6） |
| I7  | **系統角色不可刪除**                           | Service 層檢查 ＋ DB trigger（雙保險；硬刪除與軟刪除 `deleted_at` 都擋） |
| I8  | **系統中永遠至少有一個可用的 super-admin**     | 刪除／停用／拔角色時，Service 在寫入的交易內以 advisory lock 序列化後計數（[`05-rbac.md`](../architecture/backend/05-rbac.md) §8.2）；只有 super-admin 能管理 super-admin；登入失敗的鎖定不改 `status`，不會讓 super-admin 變成不可用 |
| I9  | 使用者不能修改／刪除自己的帳號狀態與角色       | Service 層檢查（`actorId === targetId` → 403）       |
| I10 | 授予的權限必須存在於 `permissions`             | Service 層檢查（`assertKeysExist`）；邊沒有外鍵      |
| I11 | 反提權：授予的權限必須 ⊆ 操作者的權限集合      | Service 層檢查（super-admin 豁免）                   |
| I12 | `audit_logs` 不可 UPDATE / DELETE              | DB role 權限 ＋ `BEFORE UPDATE/DELETE` trigger raise |

---

## 5. 系統角色保護

`is_system = true` 的角色：

| 操作                      | super-admin                     | 其他系統角色（admin / auditor / member） |
| ------------------------- | ------------------------------- | ---------------------------------------- |
| 刪除                      | ❌ `ROLE_SYSTEM_PROTECTED`      | ❌ `ROLE_SYSTEM_PROTECTED`               |
| 還原（`POST /roles/:id/restore`） | —（刪不掉，不會進回收桶）  | —                                        |
| 改 `slug`                 | ❌                              | ❌                                       |
| 改 `name` / `description` | ❌ `ROLE_SUPER_ADMIN_IMMUTABLE` | ✅                                       |
| 改權限                    | ❌ `ROLE_SUPER_ADMIN_IMMUTABLE` | ✅（仍受反提權限制）                     |
| 還原到某一版（`POST /roles/:id/revisions/:version/revert`） | ❌ `ROLE_SUPER_ADMIN_IMMUTABLE` | ✅ API 允許（前端不提供，與編輯按鈕相同） |
| 指派給使用者              | ✅                              | ✅                                       |
| 複製成新角色              | ✅（複本是一般角色）            | ✅                                       |

---

## 6. 權限解析

### 6.1 定義

權限由 **關係圖** 解析（[ADR-0024](../adr/0024-relationship-based-access-control.md)、`apps/api/src/core/authz/`）。
角色的持有者、角色的權限鍵、資料夾授權只存在 `relation_tuples`（形狀與查詢條件在 `apps/api/src/db/schema/relation-tuples.ts`）：

| 關係 | 關係圖上的邊 | 取代的舊表（G3b 已刪除，migration 0010） |
| --- | --- | --- |
| 使用者 u 持有角色 r | `role:r#holder@user:u` | `user_roles` |
| 角色 r 帶權限鍵 p | `tenant:self#<p.key>@role:r#holder` | `role_permissions` |
| super-admin 角色 | `tenant:self#superAdmin@role:<id>#holder`（seed 寫入） | — |
| 資料夾授權 | `fileFolder:F#<等級>@(role:r#holder \| user:u \| user:*)` | `resource_grants` |

使用者 `u` 的 **權限集合** ＝ 租戶節點上對 `u` 成立的權限關係：

1. 主體閉包 `S(u)` ＝ `{ user:u, user:* } ∪ { role:r#holder | u 持有未刪除的角色 r }`（一條遞迴 CTE）。
2. `S(u)` 在 `tenant:self` 上直接擁有的關係 ＝ 明確授予的鍵。
3. 每個權限關係的定義是「直接授予 ∪ superAdmin ∪ 包含它的鍵」，所以結果是明確鍵的 **依賴樹閉包**
   （[`02-permission-catalog.md`](./02-permission-catalog.md) §9）：持有 `file:delete` 就同時持有 `file:update`、`file:read`、`file:access`。

guard、`GET /auth/profile`、反提權、即時推播的 room 看到的都是閉包。角色只儲存明確授予的鍵。

權限集合有快取；任何邊的寫入都讓那個租戶的快取整個失效（`authz_revision`，
[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §5.1）。

### 6.2 super-admin 旁路

若使用者持有 super-admin 角色（`tenant:self#superAdmin` 的邊），權限集合視為 **全集**：
`PermissionsGuard` 直接放行，前端 `can()` 恆回 `true`。

實作上 `GET /auth/profile` 仍回傳完整的權限鍵陣列（把所有 `permissions.key`
都列出），讓前端不需要處理特例分支——**前端沒有「super admin」這個概念**，
只有「你持有哪些鍵」。

### 6.3 沒有 deny 規則

本模型 **只有 allow，沒有 deny**。兩個角色的權限一律取聯集。這是刻意的：
deny 規則會讓「為什麼這個人不能做 X」變成需要推理的問題。需要限制時，作法是
拆角色，而不是加否定規則。

### 6.4 關係圖的組成與模型

Google Zanzibar 的模型（OpenFGA／SpiceDB 用的同一套），只用它的子集。引擎在 `apps/api/src/core/authz/`
（[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.2），決策見 [ADR-0024](../adr/0024-relationship-based-access-control.md)。

```
  user:bob ── holder ──▶ role:editor ── tenant:self#file:update 的主體 ──▶ tenant:self
                                                                              ▲ tenant（隱含邊，每個物件都有）
       fileFolder:素材 ◀── inherits_from ── fileFolder:角色 ◀── editor ── role:editor#holder
                                                ▲ parent
                                           file:hero.png ◀── owner ── user:bob
```

- **節點** `型別:id`：`user`、`group`、`role`、`tenant`（每個租戶 DB 只有一個，id 固定 `self`）、`fileRoot`（根目錄）、`fileFolder`、`file`。
- **邊** `物件#關係@主體`。主體有三種：
  - 一個節點（`user:alice`）；
  - 一個節點的關係，也就是一群使用者（`role:editor#holder`、`group:美術#member`）；
  - 萬用字元（`user:*`，資料夾授權的「所有人」）。
- **全域權限鍵是租戶節點上的關係**：`tenant:self#role:update@role:admin#holder` ＝「admin 的持有者有 `role:update`」。
  權限鍵的字串格式因此不變。每個權限關係都定義成「直接授予 ∪ `superAdmin` ∪ 包含它的鍵」，
  super-admin 的「隱含全集」與依賴樹（[`02-permission-catalog.md`](./02-permission-catalog.md) §9）都是模型裡的定義，不是程式裡的特判。
- **資源的動作**：資料夾的等級與 `can_*` 是 `fileFolder` 型別上的關係，以 `file:<動作> from tenant` 接上全域權限
  （[`07-resource-grants.md`](./07-resource-grants.md) §2.1）。
- **結構邊不存**：資料夾的 `parent`、`inherits_from`（中斷繼承時沒有）、`owner` 由 `file_folders` 供應，
  事實來源只有一份（ADR-0024 D3）。
- **只有 allow**：模型支援交集，但只用在收窄的組合，例如「擁有者 ∧ 能在上層建立」；不支援排除（§6.3、ADR-0024 D4）。
- **模型寫在程式碼裡**：和權限目錄一樣隨版本演進，租戶不能改。啟動時驗證模型，模型不合法就啟動失敗。

| 概念 | 圖上 |
| --- | --- |
| 使用者持有角色 | `role:r#holder@user:u` |
| 群組的成員（巢狀時是另一個群組的成員） | `group:g#member@user:u`、`group:g#member@group:h#member` |
| 群組持有角色（不能是 super-admin，ADR-0024 D12） | `role:r#holder@group:g#member` |
| 角色帶權限鍵 | `tenant:self#<key>@role:r#holder` |
| super-admin | `tenant:self#superAdmin@role:<super-admin>#holder` |
| 資料夾授權（角色／個人／群組／所有人） | `fileFolder:F#<等級>@role:r#holder`、`@user:u`、`@group:g#member`、`@user:*` |
| 授權的期限 | 邊上的 `expires_at`，解析時忽略過期的 |
| 中斷繼承 | 不產生 `inherits_from` 邊 |
| 擁有者規則 | `owner` 關係 ＋ 交集（規則 A：能在這裡建立 ⇒ 能編輯自己建立的） |

**不進圖的規則**：下面這些是資源的狀態，不是關係，所以仍在 service 裡檢查。

- 系統角色保護（§5）、最後一位 super-admin（I8）、不能操作自己（I9）；
- 遞迴刪除的子樹條件（[`07-resource-grants.md`](./07-resource-grants.md) §4）；
- 上傳中的檔案只有本人看得到、系統資料夾不可移動。

圖回答「有沒有這條關係」，也回答反提權的「寫入這條邊，主體取得什麼」：模型為每個型別宣告哪些關係是 **能力**
（租戶上的權限鍵與 `superAdmin`、資料夾上的 `can_*`），引擎沿著邊算出取得的能力，操作者必須全部都有
（[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1、ADR-0024 G4）。

**平台管理者不進圖**：`platform_admins.role` 是固定的角色與權限對照，範圍小（[`02-permission-catalog.md`](./02-permission-catalog.md) §8）。

---

## 7. 預留的延伸點

以下不在 Phase 0 實作，但結構上已經留好位置：

| 延伸                                   | 預留方式                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **資源作用域**（「只能編輯自己專案」） | 已由檔案資料夾先行實作，並改由關係圖解析（資料夾的等級是模型裡的關係，沿 `inherits_from` 繼承）。專案、關卡以同樣方式加入型別，見 [`07-resource-grants.md`](./07-resource-grants.md) §10 |
| **角色階層**                           | 關係圖上是一種 `role#holder` 包含 `role#holder` 的邊；**不開放**，維持「複製角色」（[ADR-0024](../adr/0024-relationship-based-access-control.md) D10） |
| **條件式權限（ABAC）**                 | `relation_tuples` 的邊增加條件欄位（`condition jsonb`），Guard 端加入條件評估器                                 |
| **MFA**                                | `users.mfa_enabled` / 新表 `user_mfa_secrets`                                                                   |
| **API Token / 服務帳號**               | 新增 `service_accounts` 表，以新的主體型別持有角色（`role:r#holder@serviceAccount:s`）                          |

多租戶已經做了，方式不是 `tenant_id` 加 RLS，而是 **每個租戶一個 database**：這份領域模型整份存在每個租戶的 DB 裡，
各租戶各一套權限目錄、角色與使用者（[`../architecture/05-tenancy.md`](../architecture/05-tenancy.md)、[ADR-0020](../adr/0020-physical-tenant-isolation.md)）。
平台管理者另有一份很小的權限目錄與固定角色（[`02-permission-catalog.md`](./02-permission-catalog.md) §8）。

延伸時的相容性承諾：**權限鍵的字串格式不會變**，因此既有的
`@RequirePermissions('role:update')` 宣告與前端的 `can('role:update')` 都不需
要修改。

# RBAC 01 — 領域模型

## 1. 模型選擇

採用 **NIST RBAC Level 1（Flat RBAC）** ＋ 兩項強化：

| 特性                               | 是否採用   | 說明                                                                        |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------- |
| User ↔ Role 多對多                 | ✅         | 一個使用者可持有多個角色                                                    |
| Role ↔ Permission 多對多           | ✅         | 權限是預先定義的目錄，不可由使用者自創                                      |
| 角色階層（Hierarchical RBAC）      | ❌         | 見 §8，用「複製角色」取代繼承 |
| 職責分離（SoD / Constrained RBAC） | ❌         | Phase 0 不做互斥角色                                                        |
| 資源作用域（Scoped / ABAC）        | ◐ 檔案     | 檔案管理器的資料夾層級授權，見 [`07-resource-grants.md`](./07-resource-grants.md)；其餘資源見 §7 延伸點 |
| **反提權**                         | ✅（強化） | 授權者不能授予自己沒有的權限                                                |
| **權限依賴樹**                     | ✅（強化） | 同資源的子能力與只指向 read 的依賴：持有一個鍵就持有它帶來的鍵（[`02-permission-catalog.md`](./02-permission-catalog.md) §9、§9.2 D6） |
| **系統角色保護**                   | ✅（強化） | `is_system` 角色不可刪除、不可改 `slug`（顯示名稱可改，見 §5）               |
| **儲存與解析：關係圖（ReBAC）**    | ✅         | 持有角色、角色的權限鍵、資料夾授權都是同一張 `relation_tuples` 上的邊，由同一個引擎解析（§6.4、§9）。對外仍是上面這套 RBAC：權限鍵的格式、角色、指派的 API 都沒有變 |

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
`private_payload`（只給 handler 用的內容）永不回傳、審核後清空。欄位、約束與狀態機見
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
| I6  | 刪除角色時連帶撤銷其指派                       | 角色軟刪除；持有者邊、權限鍵邊與資料夾授權都留著，解析與使用者端的讀取略過已刪除的角色（休眠的邊）。還原角色時原本的持有者自動回來；永久刪除時才刪掉所有邊（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D2，[`13-trash.md`](../architecture/backend/13-trash.md) §6） |
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

權限由 **關係圖** 解析（§9、`apps/api/src/core/authz/`）。
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
（[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.2），決策見 §9。

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
  事實來源只有一份（§9.2 D3）。
- **只有 allow**：模型支援交集，但只用在收窄的組合，例如「擁有者 ∧ 能在上層建立」；不支援排除（§6.3、§9.2 D4）。
- **模型寫在程式碼裡**：和權限目錄一樣隨版本演進，租戶不能改。啟動時驗證模型，模型不合法就啟動失敗。

| 概念 | 圖上 |
| --- | --- |
| 使用者持有角色 | `role:r#holder@user:u` |
| 群組的成員（巢狀時是另一個群組的成員） | `group:g#member@user:u`、`group:g#member@group:h#member` |
| 群組持有角色（不能是 super-admin，§9.3 D12） | `role:r#holder@group:g#member` |
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
（[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1、§9.10）。

**平台管理者不進圖**：`platform_admins.role` 是固定的角色與權限對照，範圍小（[`02-permission-catalog.md`](./02-permission-catalog.md) §8）。

---

## 7. 預留的延伸點

以下不在 Phase 0 實作，但結構上已經留好位置：

| 延伸                                   | 預留方式                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **資源作用域**（「只能編輯自己專案」） | 已由檔案資料夾先行實作，並改由關係圖解析（資料夾的等級是模型裡的關係，沿 `inherits_from` 繼承）。其他資源（專案、文件等）以同樣方式加入型別，見 [`07-resource-grants.md`](./07-resource-grants.md) §10 |
| **角色階層**                           | 關係圖上是一種 `role#holder` 包含 `role#holder` 的邊；**不開放**，維持「複製角色」（§9.3 D10） |
| **群組**                               | 已實作：巢狀成員、群組持有角色、資料夾授權給群組（[`08-groups.md`](./08-groups.md)、§9.10） |
| **條件式權限（ABAC）**                 | `relation_tuples` 的邊增加條件欄位（`condition jsonb`），Guard 端加入條件評估器                                 |
| **MFA**                                | `users.mfa_enabled` / 新表 `user_mfa_secrets`                                                                   |
| **API Token / 服務帳號**               | 已實作（[`architecture/06-external-api.md`](../architecture/06-external-api.md) §9）：服務帳號是 `users.kind = 'service'`，與人一樣以 `user:` 主體持有角色、加入群組、被授權資料夾；不另開主體型別。token 的 scopes 只限縮租戶層的權限鍵（[`../architecture/06-external-api.md`](../architecture/06-external-api.md) §2） |

多租戶已經做了，方式不是 `tenant_id` 加 RLS，而是 **每個租戶一個 database**：這份領域模型整份存在每個租戶的 DB 裡，
各租戶各一套權限目錄、角色與使用者（[`../architecture/05-tenancy.md`](../architecture/05-tenancy.md)、[`architecture/05-tenancy.md`](../architecture/05-tenancy.md) §10）。
平台管理者另有一份很小的權限目錄與固定角色（[`02-permission-catalog.md`](./02-permission-catalog.md) §8）。

延伸時的相容性承諾：**權限鍵的字串格式不會變**，因此既有的
`@RequirePermissions('role:update')` 宣告與前端的 `can('role:update')` 都不需
要修改。

---

## 8. 設計決策：扁平權限，不做資源作用域與角色階層

> 原 ADR-0006，2026-09-19 決定。檔案的部分後來由資料夾層級授權（[`07-resource-grants.md`](./07-resource-grants.md) §13）取代，其餘資源仍是扁平範圍；
> §8.3「延伸路徑」由關係圖（§9）取代。

### 8.1 背景

RBAC 有幾個常見的延伸方向：

- **資源作用域**：「可以編輯 _自己專案_ 的資源」
- **角色階層**：`admin` 繼承 `editor` 的所有權限
- **職責分離（SoD）**：互斥角色
- **條件式權限（ABAC）**：「只有在工作時間內可以」

當時規劃的主功能幾乎確定需要資源作用域（以專案為單位）。問題是現在要不要做。

### 8.2 決定

Phase 0 **只做扁平的全域 RBAC**：

- User ↔ Role 多對多，Role ↔ Permission 多對多
- 沒有作用域、沒有階層、沒有 SoD、沒有條件
- 只有 allow，沒有 deny；多角色取權限聯集
- **但結構上預留延伸點**（見 §8.3）

### 8.3 延伸路徑（不改權限鍵格式）

> 這張表是決定當時的規劃；實際的延伸改走關係圖（§9），現況見 §7。

| 延伸           | 作法                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 資源作用域     | `user_roles` 加 `scope_type` / `scope_id`（預設 `NULL` = 全域），主鍵擴成四欄。`PermissionSet` 從 `Set<key>` 變成 `Map<key, Scope[]>`，Guard 多一層 scope 比對 |
| 角色階層       | ~~新增 `role_inherits(parent_id, child_id)`，權限解析改用遞迴 CTE~~ **否決**：關係圖上仍不開放角色繼承角色，維持「複製角色」（§9.3 D10） |
| 條件式（ABAC） | `role_permissions` 加 `condition jsonb`，Guard 加條件評估器                                                                                                    |
| 多租戶         | 各表加 `tenant_id` ＋ Postgres Row Level Security                                                                                                              |

**相容性承諾**：權限鍵的字串格式（`resource:action`）不會改變。
因此所有既有的 `@RequirePermissions('role:update')` 宣告與前端的
`can('role:update')` 呼叫在延伸後都不需要修改。

### 8.4 理由

1. **主功能還不存在。** 作用域的單位是什麼——專案？工作區？資料夾？
   在沒有主功能的情況下設計作用域，設計出來的一定是錯的抽象，之後改起來比
   從零加還貴。
2. **Phase 0 的產出是「機制」。** Guard、decorator、快取、反提權、稽核——
   這些在加上作用域後全部沿用，只是判斷條件多一層。
3. **角色階層用「複製角色」取代。** 「建立一個跟 editor 一樣但多兩個權限的角色」
   透過 `POST /roles/:id/duplicate` 就能做到，而且結果是可稽核的明確清單，
   不是要遞迴展開才知道的繼承鏈。
4. **不做 deny 規則是刻意的。** deny 會讓「為什麼這個人不能做 X」變成需要推理
   的問題。需要限制時拆角色，不加否定規則。

### 8.5 代價

| 代價                                 | 評估                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| 主功能上線時必須做一次作用域改造     | 已預留 schema 與介面的延伸點；Guard 與快取層不需重寫     |
| 目前無法表達「只能改自己建立的東西」 | Phase 0 沒有「東西」可以改。使用者與角色本來就是全域資源 |
| 多角色只能取聯集，無法用 deny 收窄   | 刻意；見理由 4                                           |

### 8.6 替代方案

| 方案                                  | 不採用的理由                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 現在就做作用域                        | 在沒有主功能的情況下猜作用域的單位，錯誤成本高於延後                                                   |
| 直接上 Casbin / OPA                   | 引入一套獨立的策略語言與其評估器。對 15 個權限鍵而言，複雜度遠超收益，且策略本身變成另一個要稽核的東西 |
| 用 Postgres Row Level Security 做授權 | RLS 對多租戶很好，但表達不了「這個 API 端點需要什麼權限」這種應用層概念                                |

---

## 9. 設計決策：權限改成關係圖（ReBAC），以雙寫＋影子比對逐步切換

> 原 ADR-0024，2026-09-30 決定。G0～G3b 於 2026-09-30 實作並合併（G3a 為 96ae80a）；G4 的決定 D10～D16 於 2026-10-01 確認，
> G4a（群組、反提權一般化）與 G4b（說明）同日完成；G5 待做。延伸 [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §11（權限在伺服器端解析）；
> 取代 §8.3 的「延伸路徑」與資料夾層級授權（[`07-resource-grants.md`](./07-resource-grants.md) §13）的解析方式。

### 9.1 背景

權限判斷分成三套：全域 RBAC（`user_roles` ⋈ `role_permissions`）、資料夾授權（`resource_grants` ＋ `resolveHierarchyLevels`）、
擁有者規則（寫死在 `FileAccessContext`）。群組、專案 → 資料夾的跨資源繼承、「他為什麼能做 X」都會碰到這三套各自的上限。
同時，權限鍵之間沒有包含關係：可以授予「刪除」卻不授予「檢視」，角色的權限編輯器也無法互鎖。

相關規格：關係圖的組成見 §6.4；群組見 [`08-groups.md`](./08-groups.md)；說明見 [`09-explain.md`](./09-explain.md)；
剩下的 G5（專案）見提案 [`../features/permission-graph.md`](../features/permission-graph.md)。

### 9.2 決定

- **D1 自己在 Postgres 上實作關係圖**（Zanzibar 的 tuple 模型），不部署 OpenFGA／SpiceDB。模型只用 OpenFGA 支援的子集
  （直接、計算、`X from Y`、交集、萬用字元、過期），將來可以匯出。
- **D2 全域權限鍵是租戶節點上的關係**：`tenant:self#role:update@role:<id>#holder`；super-admin 是 `tenant:self#superAdmin`。
- **D3 結構邊（資料夾的上層、建立者）由資源自己的表提供**，不存進 `relation_tuples`。
- **D4 只有 allow**：支援交集（擁有者規則），不支援排除。
- **D6 權限依賴樹**：同資源的「子能力」與跨資源、只指向 read 的「依賴」；`create ⇒ 編輯自己建立的 ⇒ read`（規則 A）、`delete ⇒ update ⇒ read`。
  受反提權限制的鍵不能被包含。只儲存明確授予的鍵，包含的鍵是算出來的。
- **切換策略：雙寫＋影子比對。**
  - G1：新增 `relation_tuples`，migration 回填，舊表上的 trigger 在同一交易雙寫；開發與測試環境每次解析時兩套都跑、不一致就報錯（`AUTHZ_SHADOW`）。
  - G2：讀取改走引擎、依賴閉包生效；寫入仍經舊表（trigger 同步），影子比對繼續。
  - G3a：讀寫只走 tuple、以 revision 失效快取；刪影子比對。舊表與雙寫 trigger 保留——滾動部署期間舊版（G2）程序仍寫舊表，
    由 trigger 同步到 tuple；新版程式不寫舊表，trigger 不會被觸發。
  - G3b：下一次部署才把舊表、雙寫 trigger 與它們的 schema 定義一起刪掉（破壞性變更拆成兩次部署，[`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) §5.1）。
- **D7 失效廣播走平台 DB 的單一頻道**：`authz_revision` 由租戶 DB 的 trigger 在同一交易遞增；提交後程式在平台 DB `NOTIFY`
  （payload `{ tenant, revision }`），每個程序一條 LISTEN 連線（`core/broadcast`）。其他程序內的快取之後共用這條頻道。
- **D8 一個租戶一個 revision**：任何 tuple 寫入都讓整個租戶的閉包失效，重算按需、lazy；有指標顯示壓力再拆。
- **D9 G3 不改反提權**：`assertGrantable`、`assertRolesAssignable` 保留，只換資料來源；由模型宣告「誰能寫這條邊」的一般化隨 G4（群組）一起做，
  讓 G3 維持對外無行為變化的純搬遷。

（沒有 D5。）

### 9.3 決定（G4：群組、反提權、explain）

2026-10-01 決定，於 G4a、G4b 實作（§9.10、§9.11）。

- **D10 不開放角色繼承角色**：維持 §8 的「複製角色」。角色的權限永遠是明確清單，
  反提權、自我鎖定、I8 都只看一個角色；分組的需求由群組處理。
- **D11 把人放進群組 ＝ 指派群組持有的角色**：寫入 `group:G#member@user:u`（或 `@group:H#member`）時，
  G **與它的所有上層群組** 持有的角色都要通過指派角色的反提權（`403 AUTHZ_ESCALATION`）。附帶規則：
  - 操作者不能把自己、或自己所屬的群組加進群組（I9 的延伸）。
  - 移除成員不檢查反提權；目標是 super-admin 時只有 super-admin 能操作（比照 `UserService.assertCanManage`）。
  - 從回收桶還原群組時，持有的角色隨保留的邊重新生效，還原前先以本條檢查（比照 `UserService.restore`）。
- **D12 群組不能持有 super-admin**：super-admin 一律直接指派給使用者。`group:assignRole` 指定 super-admin 一律拒絕，
  因此「是不是 super-admin」（`hasRoleSlug`、`assertCanManage`、I8 的計數）仍只看直接持有的角色，不必改成走主體閉包。
- **D13 反提權檢查的是「授予給一個主體」的能力**：把人放進一個主體（角色、群組）時，只檢查那個主體帶的 **全域權限鍵**，
  不檢查它在資料夾上的授權——那些授權在授予給這個主體時，已由持有 `can_share` 的人檢查過一次。與指派角色的行為一致。
- **D14 explain 逐節點遮蔽**：查自己不需要 `authz:explain`；路徑上操作者沒有讀取權（`group:read`、`role:read`、資料夾的 `can_read`）的節點，
  只回型別（「某個群組」），不回 id 與名稱，段數與關係照樣顯示。使用者 **直接所屬** 的群組、直接持有的角色一律顯示。
  主體閉包要記下路徑（`subjectClosures` 的遞迴 CTE 多帶一個路徑陣列），explain 才能從使用者本人串起。
- **D15 G4 不做外部 IdP 的群組對應**：群組只有手動成員；IdP 群組對應另開提案，與 SCIM 一起評估，預設方向是「整個群組由 IdP 管理、不能手動改成員」。
- **D16 G4 不下放群組管理**：只有 `group:update` 能管成員。將來要加 `owner` 關係時，要先重新評估 D13——
  owner 能把群組的資料夾授權擴散給任何人，等於下放 `can_share`。

### 9.4 理由

1. 稽核在交易內、權限寫入與業務寫入同一個交易；外部授權服務會變成雙寫問題。每個租戶一個 database 也讓外部服務的隔離變複雜。
2. trigger 雙寫讓 G1 不必修改任何寫入路徑，也不可能漏掉某條路徑；影子比對讓既有的整合測試直接成為新舊一致的驗收。
3. 依賴樹寫在模型裡，guard、資源的 `can_*`、反提權、profile 自動一致；前端的技能樹只是把同一份資料畫出來。

### 9.5 代價

| 代價 | 緩解 |
| --- | --- |
| G1～G3a 期間舊表仍在（G1～G2 同一份資料存兩份；G3a 起程式不再讀寫舊表） | trigger 保證同交易；`test/relation-tuples.spec.ts` 逐種寫入比對（與 trigger 一起在 G3b 刪除）；G3b 刪舊表與 trigger（migration 0010） |
| G1～G2 的影子比對讓開發環境的解析多一倍查詢 | 只在快取未命中時比；正式環境預設關閉；G3a 已刪除 |
| 依賴閉包讓部分自訂角色多出權限（例：只有 `file:create` 的角色取得全域讀取） | seed 時寫稽核 `role.permissionsImplied` 列出多出的鍵；發佈說明點名 |
| G3a 起每次權限寫入都多一次平台 DB 的 `NOTIFY`，監聽連線斷線期間的通知會漏 | 送出失敗只記錄；重連時整個權限快取丟棄；TTL 仍是安全網 |
| G3 起失效粒度變粗（任何授權變更讓整個租戶重算） | 按需重算、每人一句 CTE；拆 revision 的條件見 D8 |
| 提交後、`NOTIFY` 前程序掛掉會漏一次失效 | TTL 60 秒兜底；revision 單調遞增，下一次通知就會補上 |

### 9.6 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| OpenFGA／SpiceDB | 見 §9.4 理由 1 |
| 直接切換（不雙寫） | 使用者選擇較保守的切換方式；影子比對也能在開發環境持續驗證 |
| 只把資源授權放進圖、全域 RBAC 不動 | 留下兩種寫入路徑，群組持有角色時失效範圍要兩邊各算一次 |
| 在租戶 DB `pg_notify`（D7 的替代） | `NOTIFY` 只送得到同一個 database，每個租戶要一條常駐 LISTEN 連線 |
| 兩個 revision：全域／資源授權各一（D8 的替代） | 快取鍵與失效邏輯變複雜，目前規模看不出需要 |
| 角色繼承角色（D10 的替代） | 引擎幾乎不用改，但反提權、自我鎖定、I8 都要展開閉包，改一個角色的影響要跨角色計算；explain 回答「為什麼」，不回答「改這個會影響誰」 |
| 加成員不檢查、靠 `group:update` 把關（D11 的替代） | `group:update` 會變成繞過 `user:assignRole` 反提權的後門 |
| 允許群組持有 super-admin（D12 的替代） | 判斷 super-admin 的三處與 I8 的計數都要改成走主體閉包，換來的彈性很少用到 |
| 加成員時一併檢查群組的資料夾授權（D13 的替代） | 要掃出群組的所有資料夾授權逐一判斷；`details.missing` 還會透露操作者看不到的資料夾 |
| explain 查自己時不遮蔽，或只給第一段（D14 的替代） | 前者洩漏巢狀群組的上層與資料夾名稱；後者在資料夾繼承的情況幾乎沒有資訊 |
| G4 就做 IdP 群組同步或對應規則（D15 的替代） | 還沒有指定的 IdP；各家群組 claim 差異大（Azure AD 是 object id、有數量上限），現在設計欄位多半會猜錯 |
| 群組 `owner` 可管成員（D16 的替代） | 依 D13，owner 可以擴散群組的資料夾授權；等 G5 的專案成員管理有需求時一起評估 |

### 9.7 實作紀錄（G0～G2）

| 項目 | 位置 |
| --- | --- |
| 權限依賴樹與 G1–G4 不變條件（啟動時驗證） | `apps/api/src/db/seeds/permissions.ts`（`PERMISSION_DEPENDENCIES`）、[`02-permission-catalog.md`](./02-permission-catalog.md) §9 |
| 關係圖引擎（模型 DSL、判斷器、靜態蘊含、主體閉包 CTE） | `apps/api/src/core/authz/` |
| 檔案管理器的型別 | `apps/api/src/modules/file/file.authz.ts` |
| `relation_tuples` 與同步 trigger、回填 | migration `0007`、`0008` |
| 影子比對 | `AUTHZ_SHADOW`（G3a 已刪除） |
| 角色權限的技能樹（互鎖） | `apps/backstage/src/features/role/components/PermissionSkillTree.tsx`、`@b2b-system/ui/TreeEditor` 的狀態／分組擴充 |

與提案不同的地方：快取仍逐事件失效（`authz_revision` 與 `pg_notify` 延到 G3，寫入改經 tuple 之後才有單一的失效點）；
`resolveHierarchyLevels` 與舊的權限查詢保留到 G3，只給影子比對用。（兩者都已在 G3a 處理，見 §9.8。）

### 9.8 實作紀錄（G3a）

| 項目 | 位置 |
| --- | --- |
| 邊的形狀與查詢條件（`roleHolderTuple`、`rolePermissionTuple`、`superAdminTuple`、`isRoleHolderTuple()`…） | `apps/api/src/db/schema/relation-tuples.ts` |
| 角色持有者、角色權限鍵的讀寫 | `modules/role/role.repository.ts`、`modules/user/user.repository.ts`、`modules/permission/permission.repository.ts` |
| 資料夾授權的讀寫（原 `modules/resource-grant`，已刪除） | `modules/file/file-folder-grant.repository.ts`；等級規則在 `modules/file/file-grant.levels.ts` |
| super-admin 邊由 seed 明確寫入（冪等） | `apps/api/src/db/seeds/index.ts`（`seedRoles` → `ensureSuperAdminTuple`） |
| `authz_revision` 與遞增 trigger | migration `0009_authz_revision.sql` |
| 平台 DB 的 `LISTEN`／`NOTIFY` | `apps/api/src/core/broadcast/`（`BroadcastService`；平台 DB 的連線是 DI token `PLATFORM_SQL`） |
| revision 的失效與廣播 | `apps/api/src/core/authz/authz.revision.ts`（`AuthzRevision`，頻道 `authz_revision`）；服務端入口 `PermissionService.permissionsChanged()` |
| 測試 | `apps/api/test/authz-revision.spec.ts`、`core/authz/__tests__/authz.revision.spec.ts`、`modules/file/__tests__/file-grant.levels.spec.ts` |

與提案不同的地方：

- 雙寫 trigger（migration `0008`，含 `roles_mirror_super_admin`）沒有在 G3a 刪除，保留到 G3b 與舊表一起刪——
  [`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) 要求 migration 與前一版程式相容，滾動部署期間舊版程序仍寫舊表。
- 刪除角色是軟刪除並刪掉它的持有者邊；它的權限鍵邊、它作為主體的資料夾授權保留，解析時略過已刪除的角色。
  （[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D2、R3 起改成持有者邊也保留，還原角色時原本的持有者自動回來；永久刪除時才刪。）
- 「每個主體在一個資料夾只有一個等級」不再是 DB 的唯一索引，由 `FileFolderGrantRepository.set`（先刪後插）維持；
  授權的寫入經 `FileFolderTree.write` 序列化。

### 9.9 實作紀錄（G3b）

| 項目 | 位置 |
| --- | --- |
| 刪 migration 0008 的同步 trigger 與函式（含 `roles_mirror_super_admin`）、`user_roles`、`role_permissions`、`resource_grants` 與 enum `resource_type`、`grant_level`、`grant_subject_type` | migration `0010_drop_legacy_authz_tables.sql`（不可回退） |
| 舊表的 Drizzle schema 檔、`db/relations.ts` 的項目、`test/relation-tuples.spec.ts`、`test/db.ts` 與 `db/reset.ts` 的 TRUNCATE | 已刪除 |
| 等級與對象型別的常數（`GRANT_LEVELS`、`GRANT_SUBJECT_TYPES`、`EVERYONE_SUBJECT_ID`） | 從 `db/schema/resource-grants.ts` 移到 `modules/file/file-grant.levels.ts` |

### 9.10 實作紀錄（G4a）

| 項目 | 位置 |
| --- | --- |
| `group:*` 權限鍵、依賴樹、預設角色 | `db/seeds/permissions.ts`、`db/seeds/roles.ts`、[`02-permission-catalog.md`](./02-permission-catalog.md) §2.10 |
| `groups` 表、`updated_at` 與 revision 的 trigger | migration `0016_groups.sql`、`0017_groups_triggers.sql`；[`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) §2.14 |
| 邊的形狀（`groupMemberTuple`、`groupRoleTuple`、`isGroupMemberTuple()`、`isGroupRoleTuple()`） | `db/schema/relation-tuples.ts` |
| `group` 型別、`role#holder` 接受群組的成員、主體閉包與反向解析沿 `group#member` 走 | `core/authz/authz.types.ts`、`authz.repository.ts` |
| 群組 CRUD、成員、持有的角色、還原（D11、D12） | `modules/group/`；端點見 [`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §9 |
| 測試 | `modules/group/__tests__/group.service.spec.ts`、`test/groups.spec.ts`、`core/authz/__tests__/authz.checker.spec.ts`（群組） |

與提案不同的地方：

- **`group` 是核心型別**，不是由 `modules/group` 在 `onModuleInit` 註冊：主體閉包的遞迴 CTE（core）要知道哪些關係是成員關係、
  已刪除的節點看哪張表；與 `role` 同屬「使用者集合」。
- **群組巢狀有層數上限**（`GROUP_MAX_NESTING_DEPTH` = 6，`409 GROUP_NESTING_TOO_DEEP`）：主體閉包的深度上限是 8，
  超過的鏈會讓權限靜靜地消失，所以在寫入時擋。還原群組時也檢查循環與層數（刪除期間結構可能被改過）。
- **I9 的延伸多一條**：操作者不能改自己所屬（直接或間接）群組持有的角色（D11 只寫了加成員）；理由同 I9——等於改自己的角色。
- **成員的寫入以 advisory lock 排隊**（`group_membership`）：循環與層數的檢查要看到一致的結構，與資料夾樹同一個做法。
- **反提權一般化**：模型為每個型別宣告 **能力**（`defineType(…, { capabilities })`：租戶上的權限鍵與 `superAdmin`、資料夾上的 `can_*`），
  `AuthzService.grantedCapabilities` 算出「放進某個 `物件#關係` 取得的能力」——能力本身、等級靜態蘊含的能力、
  使用者集合往上閉包在租戶上的能力（D11、D13）。`assertGrantable`、`assertRolesAssignable`、群組的加成員都改走 `PermissionService.assertCanGrant`；
  資料夾等級的動作表改由同一個 `capabilitiesOf` 算出。super-admin 的特判（以 slug 判斷）因此拿掉：指派它取得的是 `superAdmin` 這個能力，
  `details` 的形狀不變。
- **提案的 `grantedBy`（誰能寫這條邊）沒有放進模型**：那一半已由路由宣告（`role:grantPermission`、`user:assignRole`、`group:assignRole`）與
  資料夾的 `can('share')` 擋下，錯誤是 `403 AUTHZ_FORBIDDEN` 並寫 `authz.denied`；搬進模型只是把同一個判斷宣告兩次。
- **寫入時的模型驗證以測試保證**（`validateTuple`、`src/__tests__/relation-tuples-model.spec.ts`）：邊只由 `db/schema/relation-tuples.ts` 的建構函式與
  資料夾授權的 repository 產生，每一種形狀對完整的模型驗一次；repository 不依賴 core 的服務，不在每次寫入時驗。
- 前端（`features/group`）、群組的回收桶、資料夾授權給群組、使用者與角色詳情的群組一併完成；`GET /groups` 以 `?userId=`／`?roleId=`
  篩選，不另開 `/users/:id/groups` 之類的跨資源端點。
- 既有租戶的系統角色以 migration 0018 補上群組的權限鍵（seed 只在角色新建立時寫入權限）。

### 9.11 實作紀錄（G4b）

| 項目 | 位置 |
| --- | --- |
| `authz:explain`（admin、auditor 預設持有） | `db/seeds/permissions.ts`、`roles.ts`；既有租戶由 migration `0019_authz_explain_system_roles.sql` 補上 |
| 帶路徑的主體閉包、全域權限的來源、接上閉包的來歷 | `core/authz`：`AuthzRepository.closurePaths`、`AuthzService.tenantSourcesOf`、`withClosurePath` |
| 「自己或有權限」、依操作者遮蔽（D14）、權限來源 API | `modules/authz-explain`（`GET /users/:id/permission-sources`） |
| 資料夾的說明 | `modules/file/file-access-explain.service.ts`（`GET /file-folders/:id/explain?userId=`） |
| 前端 | `core/components/ExplainPath`（路徑、`PermissionSourceList`）、個人資料頁、使用者詳情、資料夾共用對話框 |
| 規格 | [`09-explain.md`](./09-explain.md) |

與提案不同的地方：

- **沒有通用的 `GET /authz/explain?object=…`**：說明資源需要它的結構邊（資料夾的上層、繼承），只有擁有者模組載入得了，core 又不能依賴業務模組。
  所以由擁有者模組提供端點（資料夾是 `GET /file-folders/:id/explain`），名稱與可見性以 resolver 交給 `AuthzExplainService.describePaths`。
- **全域權限的來源不用判斷器的 `explain()`**：它只回第一條路徑；改以 `tenantSourcesOf` 列出租戶節點上直接取得的每一條邊，依賴樹帶出的鍵由閉包推出，
  一個鍵的所有來源（不同的角色、不同的群組）都列得出來。
- **個人資料頁也有「我的有效權限」**：提案只寫了使用者詳情；但查自己不需要權限，沒有 `user:read` 的人進不了使用者詳情，
  所以在個人資料頁另放一份（同一個 `PermissionSourceList`）。
- 「為什麼不能」的最接近缺口沒有做：不能做時只回 `allowed: false`（[`09-explain.md`](./09-explain.md) §6）。

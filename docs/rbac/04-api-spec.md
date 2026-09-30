# RBAC 04 — API 規格

所有端點皆在 `/api` 前綴之下（由反向代理／Vite proxy 加上）。
共用的回應信封、分頁與錯誤格式見
[`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md)。

圖例：

- 🔓 `@Public` — 不需登入
- 🔑 `@Authenticated` — 只要登入即可（個人範圍）
- 🛡 `@RequirePermissions(...)` — 需要列出的權限

---

## 1. Auth

| Method | Path                    | 授權            | 說明                                |
| ------ | ----------------------- | --------------- | ----------------------------------- |
| POST   | `/auth/login`           | 🔓              | 帳密登入                            |
| POST   | `/auth/refresh`         | 🔓（靠 cookie） | 以 refresh token 續期               |
| POST   | `/auth/logout`          | 🔑              | 撤銷當前 refresh token 家族         |
| GET    | `/auth/profile`         | 🔑              | 取得自己的身分、角色與 **權限集合** |
| PATCH  | `/auth/profile`         | 🔑              | 修改自己的顯示名稱與偏好設定        |
| POST   | `/auth/change-password` | 🔑              | 變更自己的密碼（需提供舊密碼）      |
| POST   | `/auth/register`        | 🔓              | 送出註冊申請（需審批，永遠回 202）  |
| POST   | `/auth/forgot-password` | 🔓              | 請求密碼重設信                      |
| POST   | `/auth/reset-password`  | 🔓              | 以 reset token 設定新密碼           |
| GET    | `/auth/setup/verify`    | 🔓              | 驗證啟用 token 是否有效             |
| POST   | `/auth/setup`           | 🔓              | 以啟用 token 設定初始密碼           |

### 1.1 `POST /auth/login`

```jsonc
// Request
{ "email": "admin@example.com", "password": "••••••••" }

// 200
{
  "data": { "accessToken": "eyJ...", "tokenType": "Bearer", "expiresIn": 300 }
}
// + Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/auth
```

速率限制：同 IP 每分鐘 10 次；同 email 連續 5 次失敗鎖定 15 分鐘。

### 1.2 `POST /auth/refresh`

必須帶自訂標頭 `x-refresh-request: 1`（CSRF 緩解）。回應同 login。

### 1.3 `GET /auth/profile`

```jsonc
// 200
{
  "data": {
    "user": {
      "id": "0192b...",
      "email": "admin@example.com",
      "username": "admin",
      "displayName": "系統管理員",
      "status": "active",
      "lastLoginAt": "2026-09-19T02:10:00.000Z",
      "preferences": { "locale": "zh-TW", "timezone": "Asia/Taipei" },
    },
    "roles": [{ "id": "...", "slug": "admin", "name": "系統管理員", "isSystem": true }],
    "permissions": ["user:create", "user:read", "role:read", "permission:read"],
  },
}
```

`permissions` 是 **扁平、已去重、已展開 super-admin、已套用權限依賴樹閉包**（[`02-permission-catalog.md`](./02-permission-catalog.md) §9）的字串陣列：
只被授予 `file:delete` 的人，這裡也會有 `file:update`、`file:read`、`file:access`。
前端 `usePermissionStore` 直接以此建立 `Set`。

### 1.4 `PATCH /auth/profile`

```jsonc
{ "displayName": "Willy", "preferences": { "locale": "en-US", "timezone": "UTC" } }
```

不可經此端點修改 `email` / `status` / 角色。

---

### 1.5 `POST /auth/register`

```jsonc
// Request
{ "email": "alice@example.com", "displayName": "Alice", "password": "…≥12 字元…", "reason": "新進企劃" }

// 202 — 不論 email 是否已註冊或已在審核中，回應都相同（帳號列舉防護）
{ "data": { "submitted": true } }
```

- 租戶關閉了註冊（系統設定 `auth.registrationEnabled`）時回 `404 AUTH_REGISTRATION_DISABLED`；
  密碼短於租戶的 `auth.passwordMinLength` 時回 `400 VALIDATION_FAILED`（[`../architecture/backend/12-settings.md`](../architecture/backend/12-settings.md) §3）。
- 不建立帳號，只建立一筆 `user.register` 審批請求；核准後才以這組 email 與密碼建立 **已啟用** 的帳號。
- 密碼在送出時就雜湊，只存在請求的 `private_payload`，審核後清空。
- 速率限制：同一個 email ＋ IP 每分鐘 `max(3, AUTH_RATE_LIMIT / 3)` 次；同 IP 另有總上限（[`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §8）。
- 流程與規則見 [`06-approval.md`](./06-approval.md) §5。

---

## 2. Users

| Method | Path                        | 授權                   | 說明                                   |
| ------ | --------------------------- | ---------------------- | -------------------------------------- |
| GET    | `/users`                    | 🛡 `user:read`          | 列表（分頁／搜尋／排序／篩選）         |
| POST   | `/users`                    | 🛡 `user:create`        | 建立（status = `pending`，寄啟用信）   |
| GET    | `/users/:id`                | 🛡 `user:read`          | 詳情（含角色）                         |
| PATCH  | `/users/:id`                | 🛡 `user:update`        | 修改基本資料 / 狀態（`active`／`inactive`；不能改回 `pending`） |
| DELETE | `/users/:id`                | 🛡 `user:delete`        | 軟刪除                                 |
| GET    | `/users/:id/roles`          | 🛡 `user:read`          | 該使用者的角色                         |
| PUT    | `/users/:id/roles`          | 🛡 `user:assignRole`    | **整批取代** 角色                      |
| GET    | `/users/:id/permissions`    | 🛡 `user:read`          | 該使用者的有效權限集合（含依賴樹閉包；除錯／稽核用） |
| POST   | `/users/:id/reset-password` | 🛡 `user:resetPassword` | 代觸發重設流程；`pending` 的人改寄啟用信 |
| POST   | `/users/:id/unlock`         | 🛡 `user:update`        | 解除登入鎖定                           |
| POST   | `/users/:id/restore`        | 🛡 `user:delete`        | 還原刪除的使用者（§2.5）               |

### 2.1 `GET /users`

**Query**

| 參數        | 型別          | 預設        | 說明                                                  |
| ----------- | ------------- | ----------- | ----------------------------------------------------- |
| `offset`    | int ≥ 0       | 0           |                                                       |
| `limit`     | int 1–200     | 20          |                                                       |
| `keyword`   | string        | —           | 模糊比對 email / username / displayName               |
| `status`    | enum[]        | —           | 可多值                                                |
| `roleId`    | uuid[]        | —           | 可多值，取聯集                                        |
| `sort`      | `<欄位>` \| `-<欄位>`[] | `-createdAt` | `-` 前綴為降冪；可多值，出現順序即優先順序；欄位為 `createdAt` / `email` / `displayName` / `lastLoginAt`，不可重複（見 [`architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §2.1） |

**回應**

```jsonc
{
  "data": {
    "items": [
      {
        "id": "...",
        "email": "a@example.com",
        "username": "alice",
        "displayName": "Alice",
        "status": "active",
        "roles": [{ "id": "...", "slug": "admin", "name": "系統管理員" }],
        "lastLoginAt": "...",
        "createdAt": "...",
        "updatedAt": "...",
      },
    ],
    "pagination": { "offset": 0, "limit": 20, "total": 137 },
  },
}
```

### 2.2 `POST /users`

```jsonc
// Request
{
  "email": "new@example.com",
  "username": "newbie", // optional
  "displayName": "新人",
  "roleIds": ["..."], // optional；受反提權檢查
}
// 201 → { "data": { ...User } }
```

不接受 `password`：一律走啟用信流程。

### 2.3 `PATCH /users/:id`

```jsonc
{ "displayName": "...", "username": "...", "status": "inactive", "version": 3 }
// 409 → { "error": { "code": "USER_VERSION_CONFLICT", "details": { "current": 4 } } }
```

- `version`（選填，樂觀鎖）：編輯開始時的版本；與目前不同回 `409 USER_VERSION_CONFLICT`（`details.current`），
  不帶則後寫者勝（[`architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11）。只帶 `version` 沒有其他欄位 → `400`

- 改 `status` 為 `inactive` → 撤銷該使用者所有 refresh token 並 `token_version + 1`
- `actorId === :id` → `403 AUTHZ_SELF_MODIFY`

### 2.4 `PUT /users/:id/roles`

```jsonc
// Request — 整批取代語意
{ "roleIds": ["role-a", "role-b"], "expectedRoleIds": ["role-a"] }

// 200 → { "data": { "roles": [ ... ] } }
// 409 → { "error": { "code": "USER_ROLES_CONFLICT", "details": { "currentRoleIds": [ ... ] } } }
```

`expectedRoleIds`（選填）：編輯開始時的角色。與目前的角色不同時回 `409 USER_ROLES_CONFLICT`，不覆寫別人剛做的變更。

檢查：反提權（§5；目標持有 super-admin 時只有 super-admin 能改）、`AUTHZ_SELF_MODIFY`、`LAST_SUPER_ADMIN`（交易內加鎖）、`USER_ROLES_CONFLICT`。

`PATCH /users/:id` 改狀態、`DELETE /users/:id` 同樣：目標持有 super-admin 時只有 super-admin 能做（`AUTHZ_ESCALATION`）。

### 2.5 `POST /users/:id/restore`

還原軟刪除的使用者（[ADR-0025](../adr/0025-entity-revisions.md) D6；能刪就能復原，所以權限是 `user:delete`）。
`status` 維持刪除前的值；refresh token、外部身分連結、啟用／重設連結不回復；持有的角色中仍存在的那些跟著生效。

```jsonc
// 200 → { "data": { /* User */ } }
// 409 → { "error": { "code": "USER_EMAIL_DUPLICATE", "details": { "field": "email", "value": "…", "conflictingUserId": "…" } } }
```

| 錯誤 | 何時 |
| --- | --- |
| `404 USER_NOT_FOUND` | 不存在，或已被永久刪除 |
| `409 USER_NOT_DELETED` | 沒有被刪除（或被別人搶先還原） |
| `409 USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE` | email／username 已被未刪除的帳號使用；`details.conflictingUserId` |
| `403 AUTHZ_ESCALATION` | 他持有的角色中有 actor 指派不了的（反提權，§5） |

回收桶的列表是 `GET /trash?type=user`（§7.2）。細節見 [`../architecture/backend/13-trash.md`](../architecture/backend/13-trash.md) §4。

### 2.6 批次操作

沒有批次端點：批次操作由前端逐筆呼叫單筆 API，見 [ADR-0012](../adr/0012-batch-queue-worker.md)。

---

## 3. Roles

| Method | Path                     | 授權                               | 說明                       |
| ------ | ------------------------ | ---------------------------------- | -------------------------- |
| GET    | `/roles`                 | 🛡 `role:read`                      | 列表                       |
| POST   | `/roles`                 | 🛡 `role:create`                    | 建立（可同時授予權限）     |
| GET    | `/roles/:id`             | 🛡 `role:read`                      | 詳情                       |
| PATCH  | `/roles/:id`             | 🛡 `role:update`                    | 修改名稱／描述（super-admin 拒絕：`ROLE_SUPER_ADMIN_IMMUTABLE`）；帶 `version`（選填）時為樂觀鎖，不符回 `409 ROLE_VERSION_CONFLICT`（`details.current`） |
| DELETE | `/roles/:id`             | 🛡 `role:delete`                    | 刪除（系統角色拒絕）       |
| GET    | `/roles/:id/permissions` | 🛡 `role:read` ＋ `permission:read` | 該角色的權限               |
| PATCH  | `/roles/:id/permissions` | 🛡 `role:grantPermission`           | 增減權限（差異語意）       |
| GET    | `/roles/:id/users`       | 🛡 `role:read` ＋ `user:read`       | 持有此角色的使用者         |
| POST   | `/roles/:id/duplicate`   | 🛡 `role:create`                    | 以既有角色為範本建立新角色 |

### 3.1 `GET /roles`

**Query**

| 參數       | 型別                    | 預設         | 說明                                                                                                   |
| ---------- | ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `offset`   | int ≥ 0                 | 0            |                                                                                                        |
| `limit`    | int 1–200               | 20           |                                                                                                        |
| `keyword`  | string                  | —            | 模糊比對 name / slug                                                                                   |
| `isSystem` | `true` \| `false`       | —            |                                                                                                        |
| `sort`     | `<欄位>` \| `-<欄位>`[] | `-createdAt` | 同 `GET /users`；欄位為 `createdAt` / `name` / `slug` / `permissionCount` / `userCount`，不可重複      |

- 每一列帶 `permissionCount`（授予的權限數）與 `userCount`（持有者數，**不含已軟刪除的使用者**，
  與 `GET /roles/:id/users` 的結果一致）。
- `permissionCount` / `userCount` 是查詢時以子查詢計算的衍生值，沒有對應欄位；
  依它們排序時需先算完所有符合條件角色的計數，兩個子查詢都走 `role_id` 開頭的索引，
  在角色數量級（數十～數百）下成本可忽略。

### 3.2 `POST /roles`

```jsonc
// Request
{
  "name": "內容編輯",
  "description": "可以編輯遊戲內容但不能管理帳號",
  "permissionKeys": ["user:read", "auditLog:read"]
}
// 201
{ "data": { "id": "...", "slug": "content-editor", "name": "內容編輯",
            "isSystem": false, "permissionCount": 2, "createdAt": "..." } }
```

- `slug` 由 `name` 自動產生（kebab-case ＋ 去重後綴），建立後不可變。
- `permissionKeys` 受反提權檢查。

### 3.3 `PATCH /roles/:id/permissions`

```jsonc
// Request — 差異語意，避免整批取代造成的競態覆寫
{ "add": ["role:read"], "remove": ["user:delete"] }

// 200（GET 的回應相同）
{
  "data": {
    "permissions": [ { "key": "file:delete", "includes": ["file:update"], "requires": [], "...": "..." } ],
    // 實際持有的鍵：明確的 ＋ 依賴樹帶出的，依目錄順序（角色權限的技能樹用）
    "effective": [
      { "key": "file:read",   "source": "implied",  "impliedBy": ["file:delete"] },
      { "key": "file:update", "source": "implied",  "impliedBy": ["file:delete"] },
      { "key": "file:delete", "source": "explicit", "impliedBy": [] },
      { "key": "file:access", "source": "implied",  "impliedBy": ["file:delete"] }
    ],
    "isSuperAdmin": false   // super-admin：effective 是全集、都算 implied、impliedBy 為空
  }
}
```

- `permissions` 只含 **明確授予** 的鍵；同時是明確與隱含的鍵算 `explicit`。
- 伺服器不因為「移除的鍵仍被其他鍵包含」而拒絕：它繼續以隱含的身分生效。「先取消上層才能取消前置」是技能樹的互鎖（UI）。

檢查順序：

0. 同一個鍵同時在 `add` 與 `remove` → `400 VALIDATION_FAILED`（意圖不明，結果也會與稽核對不上）
1. 角色存在且未刪除
2. `isSystem && slug === 'super-admin'` → `403 ROLE_SUPER_ADMIN_IMMUTABLE`
3. `add` 的鍵全部存在 → 否則 `400 PERMISSION_UNKNOWN`
4. 反提權：`add ⊆ actor 權限集合`（actor 的集合已含依賴樹閉包）→ 否則 `403 AUTHZ_ESCALATION`
5. 自我鎖定：actor 持有這個角色、且變更後（剩下的鍵套上閉包之後）會失去管理角色所需的權限 → `403 ROLE_SELF_LOCKOUT`
   （[`architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §8.4）
6. 交易（先 `FOR UPDATE` 鎖住角色列）寫入 ＋ 稽核（`before`／`after` 在交易內讀取）→ 失效快取

### 3.4 `DELETE /roles/:id`

- `isSystem` → `403 ROLE_SYSTEM_PROTECTED`（DB trigger 也擋系統角色的軟刪除）
- actor 持有這個角色、且刪除後會失去管理角色所需的權限 → `403 ROLE_SELF_LOCKOUT`
- 尚有（未刪除的）使用者持有 → 預設拒絕 `409 ROLE_IN_USE`，帶 `details.userCount`
  - 可加 `?force=true`（仍需 `role:delete`）強制刪除並連帶移除指派（刪掉角色的持有者邊），
    此時稽核紀錄 `metadata.forced = true`
- 角色是軟刪除；它的權限鍵與它作為對象的資料夾授權留著，解析時略過已刪除的角色。交易後整個租戶的權限快取失效（[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §5.1）
- 計數與刪除在同一個交易裡、先以 `FOR UPDATE` 鎖住角色列；指派角色以 `FOR SHARE` 鎖住角色列再插入。
  兩者同時發生時，後到的一方看得到先提交的結果（不會留下指向已刪除角色的指派）

### 3.5 `POST /roles/:id/duplicate`

```jsonc
{ "name": "內容編輯（唯讀）" } // 未提供則自動命名為「<原名> Copy」/「Copy 2」…
```

複製來源的權限集合，但仍受 **反提權** 限制：操作者持有的權限才會被複製過去，
其餘略過，回應中以 `data.skippedPermissions` 列出，讓 UI 可以提示。

---

## 4. Permissions

| Method | Path           | 授權                | 說明                               |
| ------ | -------------- | ------------------- | ---------------------------------- |
| GET    | `/permissions` | 🛡 `permission:read` | 全部權限目錄（不分頁）；每一項帶 `includes`（子能力）與 `requires`（依賴），見 [`02-permission-catalog.md`](./02-permission-catalog.md) §9 |

```jsonc
// 200
{
  "data": {
    "items": [
      {
        "id": "...",
        "key": "user:create",
        "resource": "user",
        "action": "create",
        "nameI18nKey": "permission.user.create",
        "sortOrder": 100,
      },
    ],
    "groups": [
      {
        "resource": "user",
        "nameI18nKey": "permission.resource.user",
        "keys": ["user:create", "user:read", "..."],
      },
    ],
  },
}
```

`groups` 是給 UI 用的分組視圖，避免前端自己 groupBy。

**沒有** POST / PATCH / DELETE。權限目錄由 seed 管理，見
[`02-permission-catalog.md`](./02-permission-catalog.md) §6。

---

## 5. 反提權規則（適用於所有授權寫入）

| 端點                           | 檢查對象                                     |
| ------------------------------ | -------------------------------------------- |
| `POST /roles`                  | `permissionKeys`                             |
| `PATCH /roles/:id/permissions` | `add`                                        |
| `POST /roles/:id/duplicate`    | 來源角色的權限集合（超出的部分略過而非拒絕） |
| `POST /users`                  | `roleIds` 各角色的權限集合聯集               |
| `PUT /users/:id/roles`         | 同上                                         |
| `POST /approvals/:id/approve`  | `roleIds`（`user.register`）同上             |
| `POST /users/:id/restore`      | 他持有的、仍存在的角色（還原會讓它們重新生效） |
| `PUT /file-folders/:id/grants`、`DELETE …/grants/:subjectType/:subjectId` | 該等級蘊含的檔案動作（以操作者 **在該資料夾** 的能力比對，見 [`07-resource-grants.md`](./07-resource-grants.md) §6.1） |

規則：`待授予集合 ⊆ actor 的權限集合`，否則 `403 AUTHZ_ESCALATION`，
`details.missing` 列出超出的鍵。

**super-admin 豁免**：持有 `super-admin` 角色者跳過此檢查（其權限集合本就是全集）。

---

## 6. Audit Logs

| Method | Path              | 授權              | 說明                          |
| ------ | ----------------- | ----------------- | ----------------------------- |
| GET    | `/audit-logs`     | 🛡 `auditLog:read` | 列表（摘要，不含 `changes` / `metadata`） |
| GET    | `/audit-logs/:id` | 🛡 `auditLog:read` | 單筆詳情（含 `changes` 差異） |

**Query**

| 參數               | 說明                                    |
| ------------------ | --------------------------------------- |
| `offset` / `limit` | 分頁（`limit` 上限 100）                |
| `actorId`          | 操作者                                  |
| `action`           | 例 `role.update`，支援前綴比對 `role.*`（`%` / `_` 視為一般字元） |
| `resourceType`     | `user` / `role` / `auth` / `permission` / `approval` / `file` / `fileFolder` |
| `resourceId`       |                                         |
| `result`           | `success` / `failure`                   |
| `from` / `to`      | ISO 8601 時間範圍；跨度最多 90 天（超過回 `400 VALIDATION_FAILED`）。都沒帶時為「現在往前 90 天」，只帶一端時往另一端推 90 天 |

排序固定為 `occurred_at DESC, id DESC`（append-only 表，不提供其他排序以確保索引命中）。
範圍早於 90 天時會連冷表一起查，對呼叫端透明。規則見
[`architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §7。

---

## 7. Approvals

| Method | Path                     | 授權                                    | 說明                         |
| ------ | ------------------------ | --------------------------------------- | ---------------------------- |
| GET    | `/approvals`             | 🛡 `approval:read`                      | 列表（分頁／篩選／排序）     |
| GET    | `/approvals/:id`         | 🛡 `approval:read`                      | 詳情                         |
| POST   | `/approvals/:id/approve` | 🛡 `approval:review` ＋ 類型要求的權限   | 核准並套用變更               |
| POST   | `/approvals/:id/reject`  | 🛡 `approval:review`                    | 駁回                         |

**`GET /approvals` Query**

| 參數               | 說明                                                          |
| ------------------ | ------------------------------------------------------------- |
| `offset` / `limit` | 分頁                                                          |
| `keyword`          | 申請人名稱（註冊 = email）部分比對                            |
| `status`           | `pending` / `approved` / `rejected`，可重複                   |
| `type`             | `user.register`，可重複                                       |
| `sort`             | `createdAt` / `reviewedAt`，`-` 前綴為降冪；預設 `-createdAt` |

**`POST /approvals/:id/approve`**

```jsonc
// Request（皆可省略）
{ "comment": "歡迎", "roleIds": ["uuid"] }   // roleIds 只對 user.register 有意義
```

回應為更新後的 `ApprovalRequest`（`status = approved`、`resultResourceId` = 新使用者 id）。
`private_payload` 永遠不會出現在任何回應中。

**`POST /approvals/:id/reject`**：`{ "comment"?: string }`，回應同上（`status = rejected`）。

| 錯誤                          | 時機                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `404 APPROVAL_NOT_FOUND`      | id 不存在                                                       |
| `409 APPROVAL_ALREADY_REVIEWED` | 已被審核過（含兩位審核者同時送出時較晚的那位）                |
| `403 APPROVAL_SELF_REVIEW`    | 審核自己送出的請求                                              |
| `403 AUTHZ_FORBIDDEN`         | 缺少類型要求的權限（`details.missing`）                         |
| `403 AUTHZ_ESCALATION`        | 指派的角色超出審核者的權限                                      |
| `409 USER_EMAIL_DUPLICATE`    | `user.register`：申請後該 email 已被建立（請改為駁回）          |

**批次**：沒有批次端點，由前端逐筆呼叫單筆 API，見 [ADR-0012](../adr/0012-batch-queue-worker.md)。

---

## 7.1 Files

檔案相關路由的 guard 只當 **閘門**：宣告 `file:access` 或對應的全域 `file:*` 其中之一（🛡 A|B）；
範圍（哪個資料夾、哪個檔案）由 service 依資料夾授權判斷，規則見 [`07-resource-grants.md`](./07-resource-grants.md) §4。
資源層級的拒絕：看不到的檔案回 `404 FILE_NOT_FOUND`（不透露存在）；資料夾對所有人可見，
沒有權限（鎖住）或權限不夠回 `403 AUTHZ_FORBIDDEN`（`details: { action, resourceType, resourceId }`）。

| Method | Path                  | 授權             | 說明                                         |
| ------ | --------------------- | ---------------- | -------------------------------------------- |
| GET    | `/files`              | 🛡 `file:access` \| `file:read`   | 列表（只含 `ready` 且看得到的；分頁／篩選／排序）        |
| GET    | `/files/upload-policy` | 🛡 `file:access` \| `file:create` | 上傳前的檢查與切塊策略                       |
| POST   | `/files`              | 🛡 `file:access` \| `file:create` | 登記上傳，回傳直傳網址（`pending`）；需要目的地的 `create` |
| POST   | `/files/:id/parts`    | 🛡 `file:access` \| `file:create` | 分塊上傳：取得各塊的直傳網址（只有上傳者本人）|
| POST   | `/files/:id/complete` | 🛡 `file:access` \| `file:create` | 確認直傳完成 → `ready`（只有上傳者本人）      |
| DELETE | `/files/:id/upload`   | 🛡 `file:access` \| `file:create` | 放棄上傳中的檔案（只有上傳者本人）           |
| GET    | `/files/:id/image/:variant` | 🔓 `@Public` ＋ 網址簽章 | 圖片的原圖／全螢幕預覽／圖示預覽（302）；網址只從看得到該檔案的回應拿得到² |
| GET    | `/files/:id`          | 🛡 `file:access` \| `file:read`   | 詳情（`pending` 只有上傳者看得到）            |
| PATCH  | `/files/:id`          | 🛡 `file:access` \| `file:update` | 改名（`{ name }`）；擁有者規則適用           |
| DELETE | `/files/:id`          | 🛡 `file:access` \| `file:delete` | 軟刪除紀錄並刪除物件；擁有者規則適用         |
| POST   | `/files/move`         | 🛡 `file:access` \| `file:update` | 把檔案與資料夾移到另一個資料夾（擋下移進自己的子孫） |
| GET    | `/file-folders`       | 🛡 `file:access` \| `file:read`   | 全部資料夾（扁平清單；沒有權限的 `capabilities.canRead = false`，申請中的 `hasPendingAccessRequest`，系統資料夾的 `kind`；別人的個人資料夾不列）、根目錄的能力、自己的 `personalFolderId` |
| POST   | `/file-folders`       | 🛡 `file:access` \| `file:create` | 建立資料夾（同一層不可同名）                 |
| POST   | `/file-folders/paths` | 🛡 `file:access` \| `file:create` | 上傳資料夾：確保各路徑存在（同名的沿用）     |
| PATCH  | `/file-folders/:id`   | 🛡 `file:access` \| `file:update` | 資料夾改名                                   |
| DELETE | `/file-folders/:id`   | 🛡 `file:access` \| `file:delete` | 遞迴刪除資料夾（連同其中的檔案與子資料夾）   |
| GET    | `/file-folders/:id/grants` | 🛡 `file:access` \| `file:share` | 授權清單：直接授權 ＋ 繼承自上層的（標出來源資料夾）；需要 `share` |
| PUT    | `/file-folders/:id/grants` | 🛡 `file:access` \| `file:share` | 新增或變更一筆授權（`{ subjectType, subjectId, level, expiresAt? }`）；**受反提權限制** |
| DELETE | `/file-folders/:id/grants/:subjectType/:subjectId` | 🛡 `file:access` \| `file:share` | 移除一筆直接授權；**受反提權限制** |
| GET    | `/file-folders/:id/grant-subjects` | 🛡 `file:access` \| `file:share` | 授權對象的候選清單（`?subjectType=role\|user&keyword=`，只回 id 與名稱） |
| POST   | `/file-folders/:id/access-requests` | 🛡 `file:access` \| `file:read` | 申請存取（`{ level, reason? }`，審批類型 `fileFolder.access`）；`202 { submitted }` |
| GET    | `/file-folders/:id/access-requests` | 🛡 `file:access` \| `file:share` | 這個資料夾的待審申請；需要 `share` |
| POST   | `/file-folders/:id/access-requests/:requestId/approve` | 🛡 `file:access` \| `file:share` | 核准（`{ comment? }`）＝ 授予申請的等級；**受反提權限制** |
| POST   | `/file-folders/:id/access-requests/:requestId/reject` | 🛡 `file:access` \| `file:share` | 駁回（`{ comment? }`） |
| PATCH  | `/file-folders/:id/access` | 🛡 `file:access` \| `file:share` | 中斷／恢復繼承（`{ inheritGrants }`）；中斷時複製目前繼承到的授權 |

² `<img src>` 帶不了 access token，所以以網址上的 HMAC 簽章（綁定檔案 id、版本與失效時間）授權，與 presigned URL 相同的模型；
簽章不符或過期回 `403 FILE_IMAGE_URL_INVALID`。見 [`architecture/backend/09-file.md`](../architecture/backend/09-file.md) §5.4。
撤銷資料夾授權後，已發出的網址在到期前仍有效。

流程、欄位與錯誤碼見 [`architecture/backend/09-file.md`](../architecture/backend/09-file.md) §4–§6（資料夾 §4.2、存取控制 §11）。

---

## 7.2 Trash（回收桶）

| Method | Path     | 授權 | 說明 |
| ------ | -------- | ---- | ---- |
| GET    | `/trash` | 🛡 任一種 `<resource>:delete`（目前 `user:delete`），再依 `type` 檢查該類型的權限 | 某一類已刪除的項目（`type` 必填，新刪除的在前；`offset`／`limit`／`keyword`） |

每一列：`id`、`type`、`name`、`description`、`deletedAt`、`deletedBy`（`{ id, name }` 或 `null`）、`purgeAt`。
還原端點在各資源（`POST /users/:id/restore`）；永久刪除只由排程 `trash.purge` 執行。
見 [`../architecture/backend/13-trash.md`](../architecture/backend/13-trash.md)。

---

## 8. System

| Method | Path            | 授權            | 說明                    |
| ------ | --------------- | --------------- | ----------------------- |
| GET    | `/health`       | 🔓              | liveness                |
| GET    | `/health/ready` | 🔓              | readiness（DB ping ＋ 物件儲存的 HeadBucket） |
| GET    | `/system/info`  | 🛡 `system:read` | 版本、建置時間、環境    |

---

## 9. HTTP 狀態碼使用約定

| 碼  | 使用時機                                                     |
| --- | ------------------------------------------------------------ |
| 200 | 讀取、更新成功                                               |
| 201 | 建立成功（`Location` 標頭指向新資源）                        |
| 202 | 已受理、尚未生效（註冊申請：待審批）                         |
| 204 | 刪除成功且無回應主體                                         |
| 400 | 請求格式／驗證錯誤（Zod 失敗、未知權限鍵）                   |
| 401 | 未認證或認證失效                                             |
| 403 | 已認證但無權限、業務規則拒絕（系統角色保護、提權、自我操作） |
| 404 | 資源不存在 **或** 無權得知其存在                             |
| 409 | 狀態衝突（名稱重複、角色使用中、審批已審核過）               |
| 422 | 語意正確但無法處理（保留，Phase 0 未使用）                   |
| 429 | 速率限制                                                     |
| 500 | 未預期錯誤（不洩漏堆疊，只回 `requestId`）                   |

> **403 vs 404 的取捨**：對「存在但你沒權限看」的資源，本系統回 **403** 而非 404。
> 理由是管理後台的使用者本來就知道系統裡有使用者與角色，隱藏存在性沒有實質
> 安全收益，反而讓「權限不足」被誤判成「資料不見了」。

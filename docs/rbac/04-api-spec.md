# RBAC 04 — API 規格

所有端點皆在 `/api` 前綴之下（由反向代理／Vite proxy 加上）。
共用的回應信封、分頁與錯誤格式見
[`../backend/03-api-conventions.md`](../backend/03-api-conventions.md)。

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

`permissions` 是 **扁平、已去重、已展開 super-admin** 的字串陣列。
前端 `usePermissionStore` 直接以此建立 `Set`。

### 1.4 `PATCH /auth/profile`

```jsonc
{ "displayName": "Willy", "preferences": { "locale": "en-US", "timezone": "UTC" } }
```

不可經此端點修改 `email` / `status` / 角色。

---

## 2. Users

| Method | Path                        | 授權                   | 說明                                   |
| ------ | --------------------------- | ---------------------- | -------------------------------------- |
| GET    | `/users`                    | 🛡 `user:read`          | 列表（分頁／搜尋／排序／篩選）         |
| POST   | `/users`                    | 🛡 `user:create`        | 建立（status = `pending`，寄啟用信）   |
| GET    | `/users/:id`                | 🛡 `user:read`          | 詳情（含角色）                         |
| PATCH  | `/users/:id`                | 🛡 `user:update`        | 修改基本資料 / 狀態                    |
| DELETE | `/users/:id`                | 🛡 `user:delete`        | 軟刪除                                 |
| GET    | `/users/:id/roles`          | 🛡 `user:read`          | 該使用者的角色                         |
| PUT    | `/users/:id/roles`          | 🛡 `user:assignRole`    | **整批取代** 角色                      |
| GET    | `/users/:id/permissions`    | 🛡 `user:read`          | 該使用者的有效權限集合（除錯／稽核用） |
| POST   | `/users/:id/reset-password` | 🛡 `user:resetPassword` | 代觸發重設流程                         |
| POST   | `/users/:id/unlock`         | 🛡 `user:update`        | 解除登入鎖定                           |

### 2.1 `GET /users`

**Query**

| 參數        | 型別          | 預設        | 說明                                                  |
| ----------- | ------------- | ----------- | ----------------------------------------------------- |
| `offset`    | int ≥ 0       | 0           |                                                       |
| `limit`     | int 1–200     | 20          |                                                       |
| `keyword`   | string        | —           | 模糊比對 email / username / displayName               |
| `status`    | enum[]        | —           | 可多值                                                |
| `roleId`    | uuid[]        | —           | 可多值，取聯集                                        |
| `sortBy`    | enum          | `createdAt` | `createdAt` / `email` / `displayName` / `lastLoginAt` |
| `sortOrder` | `asc`\|`desc` | `desc`      |                                                       |

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
{ "displayName": "...", "username": "...", "status": "inactive" }
```

- 改 `status` 為 `inactive` → 撤銷該使用者所有 refresh token 並 `token_version + 1`
- `actorId === :id` → `403 AUTHZ_SELF_MODIFY`

### 2.4 `PUT /users/:id/roles`

```jsonc
// Request — 整批取代語意
{ "roleIds": ["role-a", "role-b"] }

// 200 → { "data": { "roles": [ ... ] } }
```

檢查：反提權（§5）、`AUTHZ_SELF_MODIFY`、`LAST_SUPER_ADMIN`。

---

## 3. Roles

| Method | Path                     | 授權                               | 說明                       |
| ------ | ------------------------ | ---------------------------------- | -------------------------- |
| GET    | `/roles`                 | 🛡 `role:read`                      | 列表                       |
| POST   | `/roles`                 | 🛡 `role:create`                    | 建立（可同時授予權限）     |
| GET    | `/roles/:id`             | 🛡 `role:read`                      | 詳情                       |
| PATCH  | `/roles/:id`             | 🛡 `role:update`                    | 修改名稱／描述             |
| DELETE | `/roles/:id`             | 🛡 `role:delete`                    | 刪除（系統角色拒絕）       |
| GET    | `/roles/:id/permissions` | 🛡 `role:read` ＋ `permission:read` | 該角色的權限               |
| PATCH  | `/roles/:id/permissions` | 🛡 `role:grantPermission`           | 增減權限（差異語意）       |
| GET    | `/roles/:id/users`       | 🛡 `role:read` ＋ `user:read`       | 持有此角色的使用者         |
| POST   | `/roles/:id/duplicate`   | 🛡 `role:create`                    | 以既有角色為範本建立新角色 |

### 3.1 `POST /roles`

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

### 3.2 `PATCH /roles/:id/permissions`

```jsonc
// Request — 差異語意，避免整批取代造成的競態覆寫
{ "add": ["role:read"], "remove": ["user:delete"] }

// 200
{ "data": { "permissions": [ { "key": "...", "name": "..." } ] } }
```

檢查順序：

1. 角色存在且未刪除
2. `isSystem && slug === 'super-admin'` → `403 ROLE_SUPER_ADMIN_IMMUTABLE`
3. `add` 的鍵全部存在 → 否則 `400 PERMISSION_UNKNOWN`
4. 反提權：`add ⊆ actor 權限集合` → 否則 `403 AUTHZ_ESCALATION`
5. `LAST_SUPER_ADMIN` 檢查
6. 交易寫入 → 失效快取 → 稽核

### 3.3 `DELETE /roles/:id`

- `isSystem` → `403 ROLE_SYSTEM_PROTECTED`
- 尚有使用者持有 → 預設拒絕 `409 ROLE_IN_USE`，帶 `details.userCount`
  - 可加 `?force=true`（仍需 `role:delete`）強制刪除並連帶移除指派，
    此時稽核紀錄 `metadata.forced = true`

### 3.4 `POST /roles/:id/duplicate`

```jsonc
{ "name": "內容編輯（唯讀）" } // 未提供則自動命名為「<原名> Copy」/「Copy 2」…
```

複製來源的權限集合，但仍受 **反提權** 限制：操作者持有的權限才會被複製過去，
其餘略過，回應中以 `data.skippedPermissions` 列出，讓 UI 可以提示。

---

## 4. Permissions

| Method | Path           | 授權                | 說明                               |
| ------ | -------------- | ------------------- | ---------------------------------- |
| GET    | `/permissions` | 🛡 `permission:read` | 全部權限目錄（不分頁，固定 15 筆） |

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

規則：`待授予集合 ⊆ actor 的權限集合`，否則 `403 AUTHZ_ESCALATION`，
`details.missing` 列出超出的鍵。

**super-admin 豁免**：持有 `super-admin` 角色者跳過此檢查（其權限集合本就是全集）。

---

## 6. Audit Logs

| Method | Path              | 授權              | 說明                          |
| ------ | ----------------- | ----------------- | ----------------------------- |
| GET    | `/audit-logs`     | 🛡 `auditLog:read` | 列表                          |
| GET    | `/audit-logs/:id` | 🛡 `auditLog:read` | 單筆詳情（含 `changes` 差異） |

**Query**

| 參數               | 說明                                    |
| ------------------ | --------------------------------------- |
| `offset` / `limit` | 分頁（`limit` 上限 100）                |
| `actorId`          | 操作者                                  |
| `action`           | 例 `role.update`，支援前綴比對 `role.*` |
| `resourceType`     | `user` / `role` / `auth` / `permission` |
| `resourceId`       |                                         |
| `result`           | `success` / `failure`                   |
| `from` / `to`      | ISO 8601 時間範圍                       |

排序固定為 `occurred_at DESC`（append-only 表，不提供其他排序以確保索引命中）。

---

## 7. System

| Method | Path            | 授權            | 說明                    |
| ------ | --------------- | --------------- | ----------------------- |
| GET    | `/health`       | 🔓              | liveness                |
| GET    | `/health/ready` | 🔓              | readiness（含 DB ping） |
| GET    | `/system/info`  | 🛡 `system:read` | 版本、建置時間、環境    |

---

## 8. HTTP 狀態碼使用約定

| 碼  | 使用時機                                                     |
| --- | ------------------------------------------------------------ |
| 200 | 讀取、更新成功                                               |
| 201 | 建立成功（`Location` 標頭指向新資源）                        |
| 204 | 刪除成功且無回應主體                                         |
| 400 | 請求格式／驗證錯誤（Zod 失敗、未知權限鍵）                   |
| 401 | 未認證或認證失效                                             |
| 403 | 已認證但無權限、業務規則拒絕（系統角色保護、提權、自我操作） |
| 404 | 資源不存在 **或** 無權得知其存在                             |
| 409 | 狀態衝突（名稱重複、角色使用中）                             |
| 422 | 語意正確但無法處理（保留，Phase 0 未使用）                   |
| 429 | 速率限制                                                     |
| 500 | 未預期錯誤（不洩漏堆疊，只回 `requestId`）                   |

> **403 vs 404 的取捨**：對「存在但你沒權限看」的資源，本系統回 **403** 而非 404。
> 理由是管理後台的使用者本來就知道系統裡有使用者與角色，隱藏存在性沒有實質
> 安全收益，反而讓「權限不足」被誤判成「資料不見了」。

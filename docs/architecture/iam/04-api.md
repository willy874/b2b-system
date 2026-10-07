# 身分與存取 04 — API 規格

使用者、角色與權限的端點。其他模組的端點在各自的規格（認證 [`backend/04-auth.md`](../backend/04-auth.md) §8.3、
審批 [`backend/20-approval.md`](../backend/20-approval.md) §8、檔案 [`backend/09-file.md`](../backend/09-file.md) §6…），
端點 × 權限的總表在 [`backend/05-rbac.md`](../backend/05-rbac.md) §9。

所有端點皆在 `/api` 前綴之下（由反向代理／Vite proxy 加上）。
共用的回應信封、分頁與錯誤格式見
[`backend/03-api-conventions.md`](../backend/03-api-conventions.md)。

圖例：

- 🔓 `@Public` — 不需登入
- 🔑 `@Authenticated` — 只要登入即可（個人範圍）
- 🛡 `@RequirePermissions(...)` — 需要列出的權限

---

## 1. Users

| Method | Path                        | 授權                   | 說明                                   |
| ------ | --------------------------- | ---------------------- | -------------------------------------- |
| GET    | `/users`                    | 🛡 `user:read`          | 列表（分頁／搜尋／排序／篩選）         |
| POST   | `/users`                    | 🛡 `user:create`        | 建立（status = `pending`，寄啟用信）   |
| GET    | `/users/:id`                | 🛡 `user:read`          | 詳情（含角色）                         |
| PATCH  | `/users/:id`                | 🛡 `user:update`        | 修改基本資料 / 狀態（`active`／`inactive`；不能改回 `pending`，`pending` 也不能直接改成 `active`） |
| DELETE | `/users/:id`                | 🛡 `user:delete`        | 軟刪除                                 |
| GET    | `/users/:id/roles`          | 🛡 `user:read`          | 該使用者的角色                         |
| PUT    | `/users/:id/roles`          | 🛡 `user:assignRole`    | **整批取代** 角色                      |
| GET    | `/users/:id/permissions`    | 🛡 `user:read`          | 該使用者的有效權限集合（含依賴樹閉包；除錯／稽核用） |
| POST   | `/users/:id/reset-password` | 🛡 `user:resetPassword` | 代觸發重設流程；`pending` 的人改寄啟用信 |
| POST   | `/users/:id/unlock`         | 🛡 `user:update`        | 解除登入鎖定                           |
| POST   | `/users/:id/restore`        | 🛡 `user:delete`        | 還原刪除的使用者（§1.5）               |

### 1.1 `GET /users`

**Query**

| 參數        | 型別          | 預設        | 說明                                                  |
| ----------- | ------------- | ----------- | ----------------------------------------------------- |
| `offset`    | int ≥ 0       | 0           |                                                       |
| `limit`     | int 1–200     | 20          |                                                       |
| `keyword`   | string        | —           | 模糊比對 email / username / displayName               |
| `status`    | enum[]        | —           | 可多值                                                |
| `roleId`    | uuid[]        | —           | 可多值，取聯集                                        |
| `sort`      | `<欄位>` \| `-<欄位>`[] | `-createdAt` | `-` 前綴為降冪；可多值，出現順序即優先順序；欄位為 `createdAt` / `email` / `displayName` / `lastLoginAt`，不可重複（見 [`architecture/backend/03-api-conventions.md`](../backend/03-api-conventions.md) §2.1） |

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

### 1.2 `POST /users`

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

### 1.3 `PATCH /users/:id`

```jsonc
{ "displayName": "...", "username": "...", "status": "inactive", "version": 3 }
// 409 → { "error": { "code": "USER_VERSION_CONFLICT", "details": { "current": 4 } } }
```

- `version`（必填，樂觀鎖）：編輯開始時的版本；與目前不同回 `409 USER_VERSION_CONFLICT`（`details.current`），
  不帶 → `400 VALIDATION_FAILED`（[`architecture/backend/03-api-conventions.md`](../backend/03-api-conventions.md) §11）。只帶 `version` 沒有其他欄位 → `400`

- 改 `status` 為 `inactive` → 撤銷該使用者所有 refresh token 並 `token_version + 1`
- `pending` 只能靠啟用信離開（收得到信才證明擁有這個 email，[`backend/20-approval.md`](../backend/20-approval.md) §5）：
  `pending` → `active` 回 `400 VALIDATION_FAILED`（`fields.status`）；`pending` → `inactive` 照常，但一併清掉註冊申請時存的密碼，
  之後改回 `active` 也只能經「重設密碼」設定密碼
- `inactive` → `active`：他直接持有的角色與所屬的群組（含上層群組與群組持有的角色）跟著重新生效，
  反提權與還原相同（§2.5；[`architecture/backend/05-rbac.md`](../backend/05-rbac.md) §4.1），actor 給不了 → `403 AUTHZ_ESCALATION`
- `actorId === :id` → `403 AUTHZ_SELF_MODIFY`

### 1.4 `PUT /users/:id/roles`

```jsonc
// Request — 整批取代語意
{ "roleIds": ["role-a", "role-b"], "expectedRoleIds": ["role-a"] }

// 200 → { "data": { "roles": [ ... ] } }
// 409 → { "error": { "code": "USER_ROLES_CONFLICT", "details": { "currentRoleIds": [ ... ] } } }
```

`expectedRoleIds`（必填）：編輯開始時的角色（沒有角色時是 `[]`）。與目前的角色不同時回 `409 USER_ROLES_CONFLICT`，不覆寫別人剛做的變更；
不帶 → `400 VALIDATION_FAILED`（[`backend/14-revisions.md`](../backend/14-revisions.md) §9.2 D4）。

檢查：反提權（§4；目標持有 super-admin 時只有 super-admin 能改）、`AUTHZ_SELF_MODIFY`、`LAST_SUPER_ADMIN`（交易內加鎖）、`USER_ROLES_CONFLICT`。

角色有實際增減時，同一個交易內給被改的人一則站內通知 `user.rolesChanged`（增減的角色名稱；[`backend/15-notification.md`](../backend/15-notification.md)）。

`PATCH /users/:id` 改狀態、`DELETE /users/:id` 同樣：目標持有 super-admin 時只有 super-admin 能做（`AUTHZ_ESCALATION`）。

### 1.5 `POST /users/:id/restore`

還原軟刪除的使用者（[`backend/14-revisions.md`](../backend/14-revisions.md) §9.2 D6；能刪就能復原，所以權限是 `user:delete`）。
`status` 維持刪除前的值；refresh token、外部身分連結、啟用／重設連結不回復；持有的角色中仍存在的那些、所屬的群組（與群組帶來的角色）跟著生效。

```jsonc
// 200 → { "data": { /* User */ } }
// 409 → { "error": { "code": "USER_EMAIL_DUPLICATE", "details": { "field": "email", "value": "…", "conflictingUserId": "…" } } }
```

| 錯誤 | 何時 |
| --- | --- |
| `404 USER_NOT_FOUND` | 不存在，或已被永久刪除 |
| `409 USER_NOT_DELETED` | 沒有被刪除（或被別人搶先還原） |
| `409 USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE` | email／username 已被未刪除的帳號使用；`details.conflictingUserId` |
| `403 AUTHZ_ESCALATION` | 他持有的角色、或他所屬的群組帶來的角色中有 actor 給不了的（反提權，§4） |

回收桶的列表是 `GET /trash?type=user`（§7.2）。細節見 [`backend/13-trash.md`](../backend/13-trash.md) §4。

### 1.6 批次操作

沒有批次端點：批次操作由前端逐筆呼叫單筆 API，見 [`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13。

---

## 2. Roles

| Method | Path                     | 授權                               | 說明                       |
| ------ | ------------------------ | ---------------------------------- | -------------------------- |
| GET    | `/roles`                 | 🛡 `role:read`                      | 列表                       |
| POST   | `/roles`                 | 🛡 `role:create`                    | 建立（可同時授予權限）     |
| GET    | `/roles/:id`             | 🛡 `role:read`                      | 詳情                       |
| PATCH  | `/roles/:id`             | 🛡 `role:update`                    | 修改名稱／描述（super-admin 拒絕：`ROLE_SUPER_ADMIN_IMMUTABLE`）；`version` 必填（樂觀鎖），不符回 `409 ROLE_VERSION_CONFLICT`（`details.current`） |
| DELETE | `/roles/:id`             | 🛡 `role:delete`                    | 刪除（系統角色拒絕）       |
| GET    | `/roles/:id/permissions` | 🛡 `role:read` ＋ `permission:read` | 該角色的權限               |
| PATCH  | `/roles/:id/permissions` | 🛡 `role:grantPermission`           | 增減權限（差異語意）       |
| GET    | `/roles/:id/users`       | 🛡 `role:read` ＋ `user:read`       | 持有此角色的使用者         |
| POST   | `/roles/:id/duplicate`   | 🛡 `role:create`                    | 以既有角色為範本建立新角色 |
| POST   | `/roles/:id/restore`     | 🛡 `role:delete`                    | 還原刪除的角色（原本的持有者一併恢復） |
| GET    | `/roles/:id/revisions`   | 🛡 `role:read`                      | 版本歷史（新的在前，分頁） |
| GET    | `/roles/:id/revisions/:version` | 🛡 `role:read`               | 某一版（含快照） |
| POST   | `/roles/:id/revisions/:version/revert` | 🛡 `role:update`（權限鍵會改變時另要 `role:grantPermission`） | 還原到某一版（產生新的一版） |

### 2.1 `GET /roles`

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

### 2.2 `POST /roles`

```jsonc
// Request
{
  "name": "內容編輯",
  "description": "可以編輯業務內容但不能管理帳號",
  "permissionKeys": ["user:read", "auditLog:read"]
}
// 201
{ "data": { "id": "...", "slug": "content-editor", "name": "內容編輯",
            "isSystem": false, "permissionCount": 2, "createdAt": "..." } }
```

- `slug` 由 `name` 自動產生（kebab-case ＋ 去重後綴），建立後不可變。
- `permissionKeys` 受反提權檢查。

### 2.3 `PATCH /roles/:id/permissions`

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
   （[`architecture/backend/05-rbac.md`](../backend/05-rbac.md) §8.4）
6. 交易（先 `FOR UPDATE` 鎖住角色列）寫入 ＋ 稽核（`before`／`after` 在交易內讀取）→ 失效快取

### 2.4 `DELETE /roles/:id`

- `isSystem` → `403 ROLE_SYSTEM_PROTECTED`（DB trigger 也擋系統角色的軟刪除）
- actor 持有這個角色、且刪除後會失去管理角色所需的權限 → `403 ROLE_SELF_LOCKOUT`
- 尚有（未刪除的）使用者持有 → 預設拒絕 `409 ROLE_IN_USE`，帶 `details.userCount`
  - 持有者含 **經由群組（含巢狀）持有** 的人（[`07-groups.md`](./07-groups.md) §1）：`userCount` 是刪除後會失去這些權限的人數，
    只由群組持有的角色也算使用中。列表的 `userCount`（§2.1）只算直接持有者，所以前端在收到 `ROLE_IN_USE` 時以 `details.userCount`
    改成「仍要刪除」的確認
  - 可加 `?force=true`（仍需 `role:delete`）強制刪除，持有者立即失去這個角色的權限，
    此時稽核紀錄 `metadata.forced = true`
- 角色是軟刪除，移到回收桶；它的持有者邊、權限鍵與它作為對象的資料夾授權都留著，解析時略過已刪除的角色。
  保留期限內還原（§3.6），原本的持有者自動回來（[`backend/14-revisions.md`](../backend/14-revisions.md) §9.2 D2）。
  交易後整個租戶的權限快取失效（[`backend/05-rbac.md`](../backend/05-rbac.md) §5.1）
- 計數與刪除在同一個交易裡、先以 `FOR UPDATE` 鎖住角色列；指派角色以 `FOR SHARE` 鎖住角色列再插入。
  兩者同時發生時，後到的一方看得到先提交的結果（不會留下指向已刪除角色的指派）

### 2.5 `POST /roles/:id/duplicate`

```jsonc
{ "name": "內容編輯（唯讀）" } // 未提供則自動命名為「<原名> Copy」/「Copy 2」…
```

複製來源的權限集合，但仍受 **反提權** 限制：操作者持有的權限才會被複製過去，
其餘略過，回應中以 `data.skippedPermissions` 列出，讓 UI 可以提示。

### 2.6 `POST /roles/:id/restore`

還原軟刪除的角色（[`backend/14-revisions.md`](../backend/14-revisions.md) §9.2 D2、R3；能刪就能復原，所以權限是 `role:delete`）。
刪除時保留的持有者邊、權限鍵、資料夾授權隨之生效：原本的持有者（仍存在的使用者）自動拿回這個角色。

```jsonc
// 200 → { "data": { /* Role */, "holdersRestored": 3 } }
// 409 → { "error": { "code": "ROLE_NAME_DUPLICATE", "details": { "field": "name", "value": "…", "conflictingRoleId": "…" } } }
```

| 錯誤 | 何時 |
| --- | --- |
| `404 ROLE_NOT_FOUND` | 不存在，或已被永久刪除 |
| `409 ROLE_NOT_DELETED` | 沒有被刪除（或被別人搶先還原） |
| `409 ROLE_NAME_DUPLICATE` | 名稱或 slug 已被未刪除的角色使用；`details.field`（`name`／`slug`）、`details.conflictingRoleId` |
| `403 AUTHZ_ESCALATION` | 角色帶了 actor 沒有的權限鍵（與指派角色相同的反提權，§4） |

- `holdersRestored`：重新取得這個角色的人數，含經由群組持有的人（與 `ROLE_IN_USE` 的 `userCount` 同一個計數；直接持有者的人數是還原後的 `userCount`）。
  R3 之前刪除的角色已經沒有持有者邊，是 0。
- 回收桶的列表是 `GET /trash?type=role`（§7.2）。細節見 [`backend/13-trash.md`](../backend/13-trash.md) §6。

### 2.7 版本歷史：`/roles/:id/revisions`

每次建立、複製、改名稱或說明、增減權限鍵、還原到某一版都產生一版（[`backend/14-revisions.md`](../backend/14-revisions.md) §9.2 D1、R5）。
快照是 `{ name, description, permissionKeys }`（權限鍵排序過）。版本號是這個角色自己的流水號，與角色的 `version`（樂觀鎖）無關。
細節見 [`backend/14-revisions.md`](../backend/14-revisions.md) §4。

```jsonc
// GET /roles/:id/revisions?offset=0&limit=20 → 200
{ "data": { "items": [
  { "version": 3, "createdAt": "…", "actor": { "id": "…", "name": "Alice" }, "tooLarge": false },
  { "version": 1, "createdAt": "…", "actor": null, "tooLarge": false }   // actor null：系統（基準版本）
], "pagination": { "offset": 0, "limit": 20, "total": 3 } } }

// GET /roles/:id/revisions/1 → 200
{ "data": { "version": 1, "createdAt": "…", "actor": null, "tooLarge": false,
  "snapshot": { "name": "Editor", "description": null, "permissionKeys": ["role:read", "user:read"] } } }

// POST /roles/:id/revisions/1/revert  { "version": 4 } → 200 { "data": { /* Role，version 5 */ } }
```

還原當成一次新的更新：名稱、說明照 `PATCH /roles/:id`（本體的 `version` 是角色的版本、必填；樂觀鎖、撞名），權限鍵照 `PATCH /roles/:id/permissions`（反提權、自我鎖定），
稽核 `role.update` 帶 `metadata.revertedFrom`。

| 錯誤 | 何時 |
| --- | --- |
| `404 ROLE_NOT_FOUND` | 角色不存在或已刪除 |
| `404 REVISION_NOT_FOUND` | 那一版不存在（或已被保留清理刪除） |
| `409 REVISION_UNAVAILABLE` | 那一版過大未保存（`details.reason: 'tooLarge'`），或形狀對不上（`'incompatible'`） |
| `409 ROLE_VERSION_CONFLICT` | 帶的 `version` 不是角色目前的版本（`details.current`） |
| `409 ROLE_NAME_DUPLICATE` | 那一版的名稱已被別的角色使用 |
| `403 ROLE_SUPER_ADMIN_IMMUTABLE` | super-admin 角色 |
| `403 AUTHZ_FORBIDDEN` | 權限鍵會改變而沒有 `role:grantPermission`（`details.required`） |
| `403 AUTHZ_ESCALATION` | 會加回 actor 沒有的權限鍵（§4） |
| `403 ROLE_SELF_LOCKOUT` | 還原後自己會失去管理角色所需的權限 |

---

## 3. Permissions

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

## 4. 反提權規則（適用於所有授權寫入）

| 端點                           | 檢查對象                                     |
| ------------------------------ | -------------------------------------------- |
| `POST /roles`                  | `permissionKeys`                             |
| `PATCH /roles/:id/permissions` | `add`                                        |
| `POST /roles/:id/duplicate`    | 來源角色的權限集合（超出的部分略過而非拒絕） |
| `POST /users`                  | `roleIds` 各角色的權限集合聯集               |
| `PUT /users/:id/roles`         | 同上                                         |
| `POST /approvals/:id/approve`  | `roleIds`（`user.register`）同上             |
| `POST /users/:id/restore`      | 他持有的、仍存在的角色（還原會讓它們重新生效） |
| `POST /roles/:id/revisions/:version/revert` | 那一版比目前多出的權限鍵（加回的部分） |
| `PUT /file-folders/:id/grants`、`DELETE …/grants/:subjectType/:subjectId` | 該等級蘊含的檔案動作（以操作者 **在該資料夾** 的能力比對，見 [`06-resource-grants.md`](./06-resource-grants.md) §6.1） |

規則：`待授予集合 ⊆ actor 的權限集合`，否則 `403 AUTHZ_ESCALATION`，
`details.missing` 列出超出的鍵。

**super-admin 豁免**：持有 `super-admin` 角色者跳過此檢查（其權限集合本就是全集）。

# RBAC 02 — 權限目錄

> 本文件是 **權限的單一事實來源**。任何新增／刪除權限都必須先改這裡，再同步
> `apps/api/src/db/seeds/permissions.ts`。兩者不一致視為 bug。

---

## 1. 權限鍵格式

```
<resource>:<action>
```

- `resource`：camelCase 的資源名，單數。例：`user`、`role`、`auditLog`
- `action`：camelCase 的動作名。CRUD 使用完整單字 `create` / `read` / `update` / `delete`，
  其餘為具名動作（`assign`、`grant`、`resetPassword`…）

> **為什麼不用單字母（`user:R`）**：可讀性。`@RequirePermissions('role:update')`
> 在 code review 時不需要查表。字串長度在 HTTP 與記憶體上的差異可忽略。

### 1.1 命名規則

| 規則                                   | 說明                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| 一個權限＝一個不可再分的授權決定       | 不要有 `user:manage` 這種涵蓋多件事的鍵                             |
| `read` 涵蓋列表與詳情                  | 不拆 `list` / `detail`                                              |
| 跨資源的關聯操作歸屬「被改變的那一邊」 | 指派角色給使用者 → `user:assignRole`（改變的是使用者）              |
| 具名動作只在 CRUD 無法表達時才新增     | 「停用使用者」是改狀態 → 用 `user:update`，不新增 `user:deactivate` |

---

## 2. 權限清單（共 21 項）

### 2.1 `user` — 使用者

| 權限鍵               | 顯示名稱（zh-TW） | 說明                                   |
| -------------------- | ----------------- | -------------------------------------- |
| `user:create`        | 建立使用者        | 建立新帳號（含發送啟用信）             |
| `user:read`          | 檢視使用者        | 使用者列表與詳情                       |
| `user:update`        | 編輯使用者        | 修改基本資料、啟用／停用、解鎖         |
| `user:delete`        | 刪除使用者        | 軟刪除帳號                             |
| `user:assignRole`    | 指派角色          | 增減使用者持有的角色。**受反提權限制** |
| `user:resetPassword` | 重設密碼          | 代使用者觸發密碼重設流程               |

### 2.2 `role` — 角色

| 權限鍵                 | 顯示名稱（zh-TW） | 說明                                 |
| ---------------------- | ----------------- | ------------------------------------ |
| `role:create`          | 建立角色          | 建立新角色（可同時授予權限）         |
| `role:read`            | 檢視角色          | 角色列表與詳情、角色已授予的權限     |
| `role:update`          | 編輯角色          | 修改名稱與描述                       |
| `role:delete`          | 刪除角色          | 刪除非系統角色                       |
| `role:grantPermission` | 授予／移除權限    | 變更角色的權限集合。**受反提權限制** |

### 2.3 `permission` — 權限目錄

| 權限鍵            | 顯示名稱（zh-TW） | 說明                                         |
| ----------------- | ----------------- | -------------------------------------------- |
| `permission:read` | 檢視權限目錄      | 讀取全部可用權限。**編輯角色權限的前置條件** |

### 2.4 `auditLog` — 稽核日誌

| 權限鍵          | 顯示名稱（zh-TW） | 說明               |
| --------------- | ----------------- | ------------------ |
| `auditLog:read` | 檢視稽核日誌      | 稽核日誌列表與篩選 |

### 2.5 `system` — 系統

| 權限鍵          | 顯示名稱（zh-TW） | 說明                                     |
| --------------- | ----------------- | ---------------------------------------- |
| `system:read`   | 檢視系統資訊      | 版本、健康狀態、設定摘要                 |
| `system:update` | 變更系統設定      | 全域設定（Phase 0 尚無可設定項，先佔位） |

### 2.6 `approval` — 審批

| 權限鍵            | 顯示名稱（zh-TW） | 說明                                                                                          |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `approval:read`   | 檢視審批          | 審批請求列表與詳情                                                                            |
| `approval:review` | 審核申請          | 核准／駁回。**核准另需該類型要求的權限**（`user.register` = `user:create`），見 [`06-approval.md`](./06-approval.md) §3.2 |

> 為什麼不是 `approval:update`：核准與駁回是具名的「審核」決定，不是修改請求內容；
> 也讓「能看不能審」（auditor）與「能審」清楚分開。

### 2.7 `file` — 檔案

| 權限鍵        | 顯示名稱（zh-TW） | 說明                                                         |
| ------------- | ----------------- | ------------------------------------------------------------ |
| `file:create` | 上傳檔案          | 登記上傳並取得直傳網址、確認上傳完成；建立資料夾（含上傳資料夾時建出的結構） |
| `file:read`   | 檢視檔案          | 檔案列表與詳情，並取得預覽／下載網址                         |
| `file:update` | 編輯檔案          | 改名（內容不可改；要換內容就上傳新檔）；資料夾改名；移動檔案與資料夾 |
| `file:delete` | 刪除檔案          | 軟刪除紀錄並刪除物件儲存中的內容；遞迴刪除資料夾（連同其中的檔案與子資料夾） |

> 範圍是 **平的**（[ADR-0006](../adr/0006-flat-permission-scope.md)）：有 `file:read` 就能看所有檔案。
> 資料夾只是檔案的分類，沿用同一組權限，不另設 `fileFolder:*`。
> 唯一例外是還在上傳中（`pending`）的檔案，只有上傳者本人看得到，見
> [`../architecture/backend/09-file.md`](../architecture/backend/09-file.md) §4。

### 2.8 個人範圍（不需要權限）

以下操作 **任何已登入使用者都能做**，因為對象是自己，不進權限目錄：

- 檢視／編輯自己的個人資料（`GET|PATCH /auth/profile`）
- 變更自己的密碼（`POST /auth/change-password`）
- 檢視／修改自己的偏好設定（語系、時區）
- 登出

---

## 3. 資源 × 動作矩陣

`✓` = 存在此權限；`—` = 不存在（不要為了對稱而補）

| resource \ action | create | read | update | delete | 具名動作                      |
| ----------------- | :----: | :--: | :----: | :----: | ----------------------------- |
| `user`            |   ✓    |  ✓   |   ✓    |   ✓    | `assignRole`, `resetPassword` |
| `role`            |   ✓    |  ✓   |   ✓    |   ✓    | `grantPermission`             |
| `permission`      |   —    |  ✓   |   —    |   —    | —                             |
| `auditLog`        |   —    |  ✓   |   —    |   —    | —                             |
| `system`          |   —    |  ✓   |   ✓    |   —    | —                             |
| `approval`        |   —    |  ✓   |   —    |   —    | `review`                      |
| `file`            |   ✓    |  ✓   |   ✓    |   ✓    | —                             |

---

## 4. 預設角色 × 權限對照

| 權限鍵                 | `super-admin` | `admin` | `auditor` | `member` |
| ---------------------- | :-----------: | :-----: | :-------: | :------: |
| `user:create`          |      ✓*       |    ✓    |           |          |
| `user:read`            |      ✓*       |    ✓    |     ✓     |          |
| `user:update`          |      ✓*       |    ✓    |           |          |
| `user:delete`          |      ✓*       |    ✓    |           |          |
| `user:assignRole`      |      ✓*       |    ✓    |           |          |
| `user:resetPassword`   |      ✓*       |    ✓    |           |          |
| `role:create`          |      ✓*       |    ✓    |           |          |
| `role:read`            |      ✓*       |    ✓    |     ✓     |          |
| `role:update`          |      ✓*       |    ✓    |           |          |
| `role:delete`          |      ✓*       |    ✓    |           |          |
| `role:grantPermission` |      ✓*       |    ✓    |           |          |
| `permission:read`      |      ✓*       |    ✓    |     ✓     |          |
| `auditLog:read`        |      ✓*       |    ✓    |     ✓     |          |
| `system:read`          |      ✓*       |    ✓    |     ✓     |          |
| `system:update`        |      ✓*       |         |           |          |
| `approval:read`        |      ✓*       |    ✓    |     ✓     |          |
| `approval:review`      |      ✓*       |    ✓    |           |          |
| `file:create`          |      ✓*       |    ✓    |           |          |
| `file:read`            |      ✓*       |    ✓    |     ✓     |          |
| `file:update`          |      ✓*       |    ✓    |           |          |
| `file:delete`          |      ✓*       |    ✓    |           |          |

`*` super-admin 是 **隱含全集**，不在 `role_permissions` 中逐筆登錄；
`GET /auth/profile` 回傳時才展開成完整清單。

`member` 在 Phase 0 沒有任何權限，只能存取個人範圍的頁面（首頁、個人資料）。
這是刻意的：它是未來編輯器功能的權限掛載點。

---

## 5. 前端頁面 × 所需權限

| 頁面         | 路由                       | Page Key        | 進入所需權限                     | 判定  |
| ------------ | -------------------------- | --------------- | -------------------------------- | ----- |
| 首頁         | `/`                        | `HOME`          | 無                               | —     |
| 登入         | `/auth/login`              | 不受管          | 無（未登入可進）                 | —     |
| 申請帳號     | `/auth/register`           | 不受管          | 無（未登入可進）                 | —     |
| 個人資料     | `/profile`                 | `PROFILE`       | 無                               | —     |
| 偏好設定     | `/preference`              | `PREFERENCE`    | 無                               | —     |
| 使用者列表   | `/user`                    | `USER`          | `user:read`                      | EVERY |
| 建立使用者   | `/user/create`             | `USER_CREATE`   | `user:read` ＋ `user:create`     | EVERY |
| 角色列表     | `/role`                    | `ROLE`          | `role:read`                      | EVERY |
| 建立角色     | `/role/create`             | `ROLE_CREATE`   | `role:read` ＋ `role:create`     | EVERY |
| 角色權限管理 | `/role/$roleId/permission` | （沿用 `ROLE`） | `role:read` ＋ `permission:read` | EVERY |
| 權限目錄     | `/permission`              | `PERMISSION`    | `permission:read`                | EVERY |
| 稽核日誌     | `/audit-log`               | `AUDIT_LOG`     | `auditLog:read`                  | EVERY |
| 審批         | `/approval`（含 `/approval/$approvalId` 對話框） | `APPROVAL` | `approval:read`           | EVERY |
| 檔案         | `/file`（含 `?preview=<id>` 的 LightBox） | `FILE` | `file:read`（上傳 `file:create`、改名 `file:update`、刪除 `file:delete` 為按鈕層級） | EVERY |

> 頁面內的 **按鈕層級** gating 另由 `usePagePermission()` 派生的
> `canCreate/canRead/canUpdate/canDelete` 決定，見
> [`../architecture/frontend/06-permission.md`](../architecture/frontend/06-permission.md)。

---

## 6. Seed 資料格式

`apps/api/src/db/seeds/permissions.ts`：

```ts
export const PERMISSION_SEED = [
  // resource, action, i18n key, sort
  ["user", "create", "permission.user.create", 100],
  ["user", "read", "permission.user.read", 101],
  ["user", "update", "permission.user.update", 102],
  ["user", "delete", "permission.user.delete", 103],
  ["user", "assignRole", "permission.user.assignRole", 104],
  ["user", "resetPassword", "permission.user.resetPassword", 105],

  ["role", "create", "permission.role.create", 200],
  ["role", "read", "permission.role.read", 201],
  ["role", "update", "permission.role.update", 202],
  ["role", "delete", "permission.role.delete", 203],
  ["role", "grantPermission", "permission.role.grantPermission", 204],

  ["permission", "read", "permission.permission.read", 300],
  ["auditLog", "read", "permission.auditLog.read", 400],
  ["system", "read", "permission.system.read", 500],
  ["system", "update", "permission.system.update", 501],

  ["approval", "read", "permission.approval.read", 600],
  ["approval", "review", "permission.approval.review", 601],

  ["file", "create", "permission.file.create", 700],
  ["file", "read", "permission.file.read", 701],
  ["file", "update", "permission.file.update", 702],
  ["file", "delete", "permission.file.delete", 703],
] as const;
```

Seed 行為：

1. **Upsert**（依 `key`）— 重複執行安全。
2. seed 中不存在、DB 中存在的權限 → **不自動刪除**，只印出警告。刪除權限需要
   明確的 migration（同時處理 `role_permissions` 的清理），避免誤刪授權。
3. seed 完成後重算所有角色的權限快取版本號。

---

## 7. 新增一個權限的流程

1. 在本文件 §2 對應的資源區塊加一列。
2. 在 `db/seeds/permissions.ts` 加一筆。
3. 在 `apps/api/src/modules/<module>/<module>.constants.ts` 加常數。
4. 在 controller 用 `@RequirePermissions(...)` 宣告。
5. 在前端語系檔 `permission.<resource>.<action>` 加上 zh-TW / en-US 顯示名稱。
6. `pnpm db:seed` → `pnpm sdk:generate`。
7. 若這個權限會影響某個頁面的進入條件，更新該 feature 的 `permission.ts` 與本文件 §5。
8. 更新 §4 的預設角色對照表，並在 seed 中把它加進該角色。

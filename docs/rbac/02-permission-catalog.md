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

### 1.2 範圍（scope）

每個權限鍵屬於一個範圍（[ADR-0018](../adr/0018-workspace-tenancy.md) D2）：

| 範圍 | 由誰持有 | 在哪裡有效 | 權限鍵 |
| --- | --- | --- | --- |
| `platform` | 全域角色（`user_roles`） | 全站 | `user:*`、`role:*`、`permission:*`、`auditLog:*`、`system:*`、`approval:*`、`job:*`、`workspace:*` |
| `workspace` | 工作區角色（`workspace_member_roles`） | 只在指派的那個工作區 | `file:*`、`workspaceMember:*` |

- 角色也有範圍，只能含同範圍的鍵（service 檢查 ＋ DB trigger）；範圍建立後不可變。
- 使用者在工作區 W 的權限集合 = 平台的鍵 ∪ 在 W 的工作區角色的鍵。
- 工作區範圍的鍵只能宣告在 `@WorkspaceScoped()` 路由上，平台的鍵只能宣告在其他路由上（`route-audit` 啟動檢查）。
- super-admin 是兩個範圍的全集，而且能進入任何工作區（D5）。

---

## 2. 權限清單（共 37 項：平台 27、工作區 10）

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

### 2.7 `file` — 檔案（工作區範圍）

| 權限鍵        | 顯示名稱（zh-TW） | 說明                                                         |
| ------------- | ----------------- | ------------------------------------------------------------ |
| `file:create` | 上傳檔案          | **這個工作區的所有資料夾**：登記上傳並取得直傳網址、確認上傳完成；建立資料夾（含上傳資料夾時建出的結構） |
| `file:read`   | 檢視檔案          | **這個工作區的所有資料夾**：檔案列表與詳情，並取得預覽／下載網址         |
| `file:update` | 編輯檔案          | **這個工作區的所有資料夾**：改名（內容不可改；要換內容就上傳新檔）；資料夾改名；移動檔案與資料夾 |
| `file:delete` | 刪除檔案          | **這個工作區的所有資料夾**：軟刪除紀錄並刪除物件儲存中的內容；遞迴刪除資料夾（連同其中的檔案與子資料夾） |
| `file:access` | 使用檔案管理器    | 進入檔案管理器；能看到、能做什麼 **由資料夾授權決定**（不含任何資料夾） |
| `file:share`  | 管理檔案授權      | **這個工作區的所有資料夾**：檢視與變更資料夾的授權、中斷繼承。**受反提權限制** |

> 上面四個 CRUD 鍵在 **工作區內** 是全域的：持有者對這個工作區的所有資料夾（含中斷繼承的私人資料夾）都有該動作。
> 一般成員拿 `file:access`，再由資料夾授權（viewer / contributor / editor / manager）決定範圍，
> 另有「能上傳的人可以改名、移動、刪除自己上傳的東西」的擁有者規則。
> 模型、等級與解析規則見 [`07-resource-grants.md`](./07-resource-grants.md)（[ADR-0015](../adr/0015-file-folder-access.md)）。
> 資料夾沿用同一組權限，不另設 `fileFolder:*`。還在上傳中（`pending`）的檔案只有上傳者本人看得到，見
> [`../architecture/backend/09-file.md`](../architecture/backend/09-file.md) §4。

### 2.8 `job` — 背景工作

| 權限鍵      | 顯示名稱（zh-TW） | 說明                                                                 |
| ----------- | ----------------- | -------------------------------------------------------------------- |
| `job:read`  | 檢視背景工作      | 佇列狀態、工作列表與詳情（含工作資料與失敗原因）                     |
| `job:retry` | 重試背景工作      | 把重試用完、停在失敗的工作重新排入；寫稽核 `job.retry`               |

> 工作是系統自己產生的（排程、寄信、匯出），沒有 create / update / delete；
> 重試是具名動作，理由同 `approval:review`。工作資料不放機密（token、密碼），
> 因此 `job:read` 不會看到憑證，見 [`../architecture/backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4。

### 2.9 `workspace` — 工作區（平台範圍）

| 權限鍵             | 顯示名稱（zh-TW） | 說明 |
| ------------------ | ----------------- | ---- |
| `workspace:create` | 建立工作區        | 建立工作區並指定第一位管理員（取得 `workspace-admin`；這一步豁免反提權，ADR-0018 D13） |
| `workspace:read`   | 檢視工作區        | 所有工作區的清單、成員數與管理員；**看不到工作區裡的內容**（D5） |
| `workspace:update` | 編輯工作區        | 改名稱與說明；指定管理員（加入成員並給 `workspace-admin`，留下稽核，D12） |
| `workspace:delete` | 刪除工作區        | 軟刪除；成員立刻進不去 |

### 2.10 `workspaceMember` — 工作區成員（工作區範圍）

| 權限鍵                        | 顯示名稱（zh-TW） | 說明 |
| ----------------------------- | ----------------- | ---- |
| `workspaceMember:read`        | 檢視成員          | 這個工作區的成員與他們的工作區角色；可以指派的工作區角色清單 |
| `workspaceMember:create`      | 邀請成員          | 以 email 邀請成員並指定工作區角色、撤銷待接受的邀請（ADR-0018 D14）。角色 **受反提權限制**；邀請還沒有帳號的 email 另需平台的 `user:create` |
| `workspaceMember:delete`      | 移除成員          | 移出工作區（工作區角色一起消失）。拿掉的角色受反提權限制；不能移除自己、不能移除最後一位管理員 |
| `workspaceMember:assignRole`  | 指派工作區角色    | 整批取代成員的工作區角色。**受反提權限制**（加上與拿掉的角色都比對操作者在這個工作區的權限） |

### 2.11 `identityProvider` — 外部 IdP 連線（平台範圍）

| 權限鍵                     | 顯示名稱（zh-TW） | 說明 |
| -------------------------- | ----------------- | ---- |
| `identityProvider:create`  | 建立外部 IdP 連線 | 新增 OIDC 連線（issuer、client id／secret、網域、找不到帳號時的處理方式）；寫稽核 `identityProvider.create`（不含 secret） |
| `identityProvider:read`    | 檢視外部 IdP 連線 | 連線清單、網域與要登記在外部 IdP 的 redirect URI；**client secret 永遠不回傳**（ADR-0019 D11） |
| `identityProvider:update`  | 編輯外部 IdP 連線 | 改設定、網域、啟用狀態與輪替 secret；稽核只記「換過 secret」 |
| `identityProvider:delete`  | 刪除外部 IdP 連線 | 軟刪除並釋出網域；已連結的外部身分留著，但不能再以這個連線登入 |

> 網域設為「只允許 SSO」後，那個網域的帳號不能用密碼登入、不能申請重設密碼（ADR-0019 D9）。
> 管理頁在 apps/auth（`/identity-providers`），不在 apps/backstage。

### 2.12 個人範圍（不需要權限）

以下操作 **任何已登入使用者都能做**，因為對象是自己，不進權限目錄：

- 檢視／編輯自己的個人資料（`GET|PATCH /auth/profile`）
- 變更自己的密碼（`POST /auth/change-password`）
- 檢視／修改自己的偏好設定（語系、時區）
- 登出
- 自己能進入的工作區（`GET /workspaces/mine`）、自己在某個工作區的身分（`GET /workspaces/:id/me`，需要是成員）

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
| `file`            |   ✓    |  ✓   |   ✓    |   ✓    | `access`, `share`             |
| `job`             |   —    |  ✓   |   —    |   —    | `retry`                       |
| `workspace`       |   ✓    |  ✓   |   ✓    |   ✓    | —                             |
| `workspaceMember` |   ✓    |  ✓   |   —    |   ✓    | `assignRole`                  |
| `identityProvider`|   ✓    |  ✓   |   ✓    |   ✓    | —                             |

---

## 4. 預設角色 × 權限對照

### 4.1 平台角色（`scope = platform`）

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
| `job:read`             |      ✓*       |    ✓    |     ✓     |          |
| `job:retry`            |      ✓*       |    ✓    |           |          |
| `workspace:create`     |      ✓*       |    ✓    |           |          |
| `workspace:read`       |      ✓*       |    ✓    |     ✓     |          |
| `workspace:update`     |      ✓*       |    ✓    |           |          |
| `workspace:delete`     |      ✓*       |    ✓    |           |          |
| `identityProvider:create` |   ✓*       |    ✓    |           |          |
| `identityProvider:read`   |   ✓*       |    ✓    |     ✓     |          |
| `identityProvider:update` |   ✓*       |    ✓    |           |          |
| `identityProvider:delete` |   ✓*       |    ✓    |           |          |

`*` super-admin 是 **隱含全集**（兩個範圍都是），不在 `role_permissions` 中逐筆登錄；
`GET /auth/profile` 回傳時展開成平台範圍的全集，`GET /workspaces/:id/me` 展開成工作區範圍的全集。

`member` 沒有任何平台的鍵：只能存取個人範圍的頁面。它是未來平台功能的權限掛載點；
工作區裡能做什麼由工作區角色決定。

### 4.2 工作區角色（`scope = workspace`）

| 權限鍵                        | `workspace-admin` | `workspace-member` | `workspace-viewer` |
| ----------------------------- | :---------------: | :----------------: | :----------------: |
| `file:create`                 |         ✓         |                    |                    |
| `file:read`                   |         ✓         |                    |         ✓          |
| `file:update`                 |         ✓         |                    |                    |
| `file:delete`                 |         ✓         |                    |                    |
| `file:access`                 |         ✓         |         ✓          |                    |
| `file:share`                  |         ✓         |                    |                    |
| `workspaceMember:read`        |         ✓         |         ✓          |         ✓          |
| `workspaceMember:create`      |         ✓         |                    |                    |
| `workspaceMember:delete`      |         ✓         |                    |                    |
| `workspaceMember:assignRole`  |         ✓         |                    |                    |

`workspace-member` 只有 `file:access`：進得了檔案管理器，看得到資料夾但鎖住，被授權之後才讀得到。
`workspace-admin` 也持有 `file:access`：不擴大能力（已有 `file:*`），但指派 `workspace-member` 受反提權限制，要持有它的每個權限鍵。

> 工作區範圍的鍵在 **角色定義** 上不檢查反提權（平台管理員定義工作區角色時，自己在任何工作區都可能沒有這些鍵）；
> 真正的授予發生在 **指派** 到某個工作區時，以指派者在那個工作區的權限比對（ADR-0018 D3）。

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
| 背景工作     | `/job`（含 `/job/$jobId` 對話框） | `JOB` | `job:read`                      | EVERY |
| 工作區管理   | `/workspace`               | `WORKSPACE_ADMIN` | `workspace:read`               | EVERY |
| 檔案         | `/w/$workspaceSlug/file`（含 `?preview=<id>` 的 LightBox） | `FILE` | 工作區範圍：`file:access` 或 `file:read`（按鈕層級看後端回傳的 `capabilities`，見 [`07-resource-grants.md`](./07-resource-grants.md) §7） | SOME |
| 工作區成員   | `/w/$workspaceSlug/members` | `WORKSPACE_MEMBER` | 工作區範圍：`workspaceMember:read` | EVERY |

> 工作區頁面（`/w/:workspaceSlug/…`）由工作區的版面把關：先確認是成員（不是回「找不到這個工作區」），
> 載入在這個工作區的權限之後才判斷頁面權限（[ADR-0018](../adr/0018-workspace-tenancy.md) D17）。

> 頁面內的 **按鈕層級** gating 另由 `usePagePermission()` 派生的
> `canCreate/canRead/canUpdate/canDelete` 決定，見
> [`../architecture/frontend/06-permission.md`](../architecture/frontend/06-permission.md)。

---

## 6. Seed 資料格式

`apps/api/src/db/seeds/permissions.ts`：

```ts
export const PERMISSION_SEED = [
  // resource, action, i18n key, sort, scope（docs/adr/0018-workspace-tenancy.md D2）
  ["user", "create", "permission.user.create", 100, "platform"],
  ["user", "read", "permission.user.read", 101, "platform"],
  ["user", "update", "permission.user.update", 102, "platform"],
  ["user", "delete", "permission.user.delete", 103, "platform"],
  ["user", "assignRole", "permission.user.assignRole", 104, "platform"],
  ["user", "resetPassword", "permission.user.resetPassword", 105, "platform"],

  ["role", "create", "permission.role.create", 200, "platform"],
  ["role", "read", "permission.role.read", 201, "platform"],
  ["role", "update", "permission.role.update", 202, "platform"],
  ["role", "delete", "permission.role.delete", 203, "platform"],
  ["role", "grantPermission", "permission.role.grantPermission", 204, "platform"],

  ["permission", "read", "permission.permission.read", 300, "platform"],
  ["auditLog", "read", "permission.auditLog.read", 400, "platform"],
  ["system", "read", "permission.system.read", 500, "platform"],
  ["system", "update", "permission.system.update", 501, "platform"],

  ["approval", "read", "permission.approval.read", 600, "platform"],
  ["approval", "review", "permission.approval.review", 601, "platform"],

  ["file", "create", "permission.file.create", 700, "workspace"],
  ["file", "read", "permission.file.read", 701, "workspace"],
  ["file", "update", "permission.file.update", 702, "workspace"],
  ["file", "delete", "permission.file.delete", 703, "workspace"],
  ["file", "access", "permission.file.access", 704, "workspace"],
  ["file", "share", "permission.file.share", 705, "workspace"],

  ["job", "read", "permission.job.read", 800, "platform"],
  ["job", "retry", "permission.job.retry", 801, "platform"],

  ["workspace", "create", "permission.workspace.create", 900, "platform"],
  ["workspace", "read", "permission.workspace.read", 901, "platform"],
  ["workspace", "update", "permission.workspace.update", 902, "platform"],
  ["workspace", "delete", "permission.workspace.delete", 903, "platform"],

  ["workspaceMember", "read", "permission.workspaceMember.read", 1000, "workspace"],
  ["workspaceMember", "create", "permission.workspaceMember.create", 1001, "workspace"],
  ["workspaceMember", "delete", "permission.workspaceMember.delete", 1002, "workspace"],
  ["workspaceMember", "assignRole", "permission.workspaceMember.assignRole", 1003, "workspace"],
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

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

## 2. 權限清單（共 29 項）

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
| `system:read`   | 檢視系統資訊      | 版本、健康狀態、系統設定頁（唯讀）       |
| `system:update` | 變更系統設定      | 修改與還原系統設定（[`../architecture/backend/12-settings.md`](../architecture/backend/12-settings.md)） |

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
| `file:create` | 上傳檔案          | **所有資料夾**：登記上傳並取得直傳網址、確認上傳完成；建立資料夾（含上傳資料夾時建出的結構） |
| `file:read`   | 檢視檔案          | **所有資料夾**：檔案列表與詳情，並取得預覽／下載網址         |
| `file:update` | 編輯檔案          | **所有資料夾**：改名（內容不可改；要換內容就上傳新檔）；資料夾改名；移動檔案與資料夾 |
| `file:delete` | 刪除檔案          | **所有資料夾**：軟刪除紀錄並刪除物件儲存中的內容；遞迴刪除資料夾（連同其中的檔案與子資料夾） |
| `file:access` | 使用檔案管理器    | 進入檔案管理器；能看到、能做什麼 **由資料夾授權決定**（不含任何資料夾） |
| `file:share`  | 管理檔案授權      | **所有資料夾**：檢視與變更資料夾的授權、中斷繼承。**受反提權限制** |

> 上面四個 CRUD 鍵是 **全域** 的：持有者對所有資料夾（含中斷繼承的私人資料夾）都有該動作。
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

### 2.9 `identityProvider` — 外部 IdP 連線

| 權限鍵                     | 顯示名稱（zh-TW） | 說明 |
| -------------------------- | ----------------- | ---- |
| `identityProvider:create`  | 建立外部 IdP 連線 | 新增 OIDC 連線（issuer、client id／secret、網域、找不到帳號時的處理方式）；寫稽核 `identityProvider.create`（不含 secret） |
| `identityProvider:read`    | 檢視外部 IdP 連線 | 連線清單、網域與要登記在外部 IdP 的 redirect URI；**client secret 永遠不回傳**（ADR-0019 D11） |
| `identityProvider:update`  | 編輯外部 IdP 連線 | 改設定、網域、啟用狀態與輪替 secret；稽核只記「換過 secret」 |
| `identityProvider:delete`  | 刪除外部 IdP 連線 | 軟刪除並釋出網域；已連結的外部身分留著，但不能再以這個連線登入 |

> 網域設為「只允許 SSO」後，那個網域的帳號不能用密碼登入、不能申請重設密碼（ADR-0019 D9）。
> 連線屬於租戶（[ADR-0020](../adr/0020-physical-tenant-isolation.md) D18），管理頁在 backstage 的 `/identity-provider`。

### 2.10 個人範圍（不需要權限）

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
| `file`            |   ✓    |  ✓   |   ✓    |   ✓    | `access`, `share`             |
| `job`             |   —    |  ✓   |   —    |   —    | `retry`                       |
| `identityProvider`|   ✓    |  ✓   |   ✓    |   ✓    | —                             |

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
| `file:access`          |      ✓*       |    ✓    |           |    ✓     |
| `file:share`           |      ✓*       |    ✓    |           |          |
| `job:read`             |      ✓*       |    ✓    |     ✓     |          |
| `job:retry`            |      ✓*       |    ✓    |           |          |
| `identityProvider:create` |   ✓*       |    ✓    |           |          |
| `identityProvider:read`   |   ✓*       |    ✓    |     ✓     |          |
| `identityProvider:update` |   ✓*       |    ✓    |           |          |
| `identityProvider:delete` |   ✓*       |    ✓    |           |          |

`*` super-admin 是 **隱含全集**，不在 `role_permissions` 中逐筆登錄；
`GET /auth/profile` 回傳時才展開成完整清單。

`member` 只有 `file:access`：進得了檔案管理器，看得到資料夾但全部鎖住，被授權之後才讀得到。
`admin` 也持有 `file:access`：不擴大能力（已有全域 `file:*`），但指派 `member` 受反提權限制，要持有它的每個權限鍵。
其餘只能存取個人範圍的頁面（首頁、個人資料）。
這是刻意的：它是未來編輯器功能的權限掛載點。

---

## 5. 前端頁面 × 所需權限

| 頁面         | 路由                       | Page Key        | 進入所需權限                     | 判定  |
| ------------ | -------------------------- | --------------- | -------------------------------- | ----- |
| 首頁         | `/`                        | `HOME`          | 無                               | —     |
| 登入         | `/auth/login`（跳到 apps/auth 的 IdP）、`/auth/callback` | 不受管 | 無（未登入可進）   | —     |
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
| 檔案         | `/file`（含 `?preview=<id>` 的 LightBox） | `FILE` | `file:access` 或 `file:read`（按鈕層級看後端回傳的 `capabilities`，見 [`07-resource-grants.md`](./07-resource-grants.md) §7） | SOME |
| 外部 IdP 連線 | `/identity-provider`      | `IDENTITY_PROVIDER` | `identityProvider:read`        | EVERY |
| 系統設定     | `/system/settings`（`system:update` 才能修改） | `SETTING` | `system:read`             | EVERY |

apps/auth 只給平台管理者登入（[`../architecture/04-sso.md`](../architecture/04-sso.md) §1.1、§6.2），這個目錄的權限不適用；
平台管理者的權限目錄在交付順序第 4 步加上租戶管理時建立。帳號流程（申請帳號、啟用、重設密碼）也在 apps/auth，未登入可進。

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
  ["file", "access", "permission.file.access", 704],
  ["file", "share", "permission.file.share", 705],

  ["job", "read", "permission.job.read", 800],
  ["job", "retry", "permission.job.retry", 801],

  ["identityProvider", "create", "permission.identityProvider.create", 1100],
  ["identityProvider", "read", "permission.identityProvider.read", 1101],
  ["identityProvider", "update", "permission.identityProvider.update", 1102],
  ["identityProvider", "delete", "permission.identityProvider.delete", 1103],
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

---

## 8. 平台的權限目錄（apps/auth 的平台管理者）

平台管理者（[ADR-0020](../adr/0020-physical-tenant-isolation.md) D5）與租戶的使用者是兩份帳號，權限目錄也是兩份：
上面 §1–§7 是 **租戶** 的目錄（存在每個租戶的 DB）；這一節是 **平台** 的目錄，只在 apps/auth 的網域有效。

- 端點以 `@RequirePlatformPermissions(...)` 宣告（所有鍵都要有），租戶網域上一律 `404 PLATFORM_ONLY`；
  拒絕寫平台稽核 `platform_audit_logs`（`authz.denied`）。
- 平台的權限 **不寫進資料庫**：角色固定三種（`platform_admins.role`），角色 × 權限的對照在
  `apps/api/src/db/seeds/platform-permissions.ts`。平台的權限範圍很小，每個管理者一個角色就夠，不提供自訂角色。
- 前端從 `GET /platform/auth/profile` 的 `permissions` 取得目前管理者的權限。

### 8.1 權限清單（共 12 項）

| 權限鍵                  | 顯示名稱（zh-TW） | 說明 |
| ----------------------- | ----------------- | ---- |
| `tenant:read`           | 檢視租戶          | 租戶清單、狀態、網域、佈建失敗的原因（不含連線字串） |
| `tenant:create`         | 建立租戶          | 建立並佈建新租戶（database、migration、第一位管理員與啟用信）、重試失敗的佈建 |
| `tenant:update`         | 編輯租戶          | 改名稱、新增／移除網域、停用與啟用（停用會撤銷該租戶的所有 session）、是否允許外部 IdP、啟用的 feature、feature flag 的租戶層覆寫 |
| `tenant:delete`         | 刪除租戶          | 標記刪除並釋出網域；database 與 bucket 由 `pnpm db:drop-tenant` 手動清除（D13） |
| `platformAdmin:read`    | 檢視平台管理者    | 管理者清單、角色與狀態 |
| `platformAdmin:create`  | 新增平台管理者    | 建立成 `pending`，寄啟用信讓本人設定密碼（不接受密碼） |
| `platformAdmin:update`  | 管理平台管理者    | 改名、換角色、停用／啟用（停用即撤銷 session，`locked` 改回 `active` 即解鎖）、寄設定密碼的連結；不能改自己的角色與狀態 |
| `platformAuditLog:read` | 檢視平台稽核      | `platform_audit_logs`：平台管理者做過的事（D19）；看不到租戶的稽核 |
| `platformJob:read`      | 檢視背景工作      | 所有租戶與平台自己的工作（D23）；租戶的後台只看得到自己的 |
| `platformJob:retry`     | 重試背景工作      | 把重試用完、停在失敗的工作重新排入；寫平台稽核 `platformJob.retry` |
| `featureFlag:read`      | 檢視試行開關      | feature flag 的目錄、全平台覆寫、各有幾個租戶覆寫（[ADR-0022](../adr/0022-feature-flags.md)） |
| `featureFlag:update`    | 切換試行開關      | 全平台層的覆寫：全面開放（`on`）、緊急關閉（`off`）、回到預設；寫平台稽核 `featureFlag.update` |

### 8.2 角色 × 權限

| 權限                    | `super-admin` | `operator` | `auditor` |
| ----------------------- | :-----------: | :--------: | :-------: |
| `tenant:read`           | ✅ | ✅ | ✅ |
| `tenant:create`         | ✅ | ✅ |    |
| `tenant:update`         | ✅ | ✅ |    |
| `tenant:delete`         | ✅ |    |    |
| `platformAdmin:read`    | ✅ | ✅ | ✅ |
| `platformAdmin:create`  | ✅ |    |    |
| `platformAdmin:update`  | ✅ |    |    |
| `platformAuditLog:read` | ✅ | ✅ | ✅ |
| `platformJob:read`      | ✅ | ✅ | ✅ |
| `platformJob:retry`     | ✅ | ✅ |    |
| `featureFlag:read`      | ✅ | ✅ | ✅ |
| `featureFlag:update`    | ✅ | ✅ |    |

只有 `super-admin` 能管理平台管理者，所以不需要反提權規則（`operator` 不能把自己升成 `super-admin`）。
`db:seed` 依 `PLATFORM_ADMIN_EMAIL` 建立的第一位平台管理者是 `super-admin`；之後新增的管理者預設是 `auditor`。

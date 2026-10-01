# 專案總覽

## 1. 專案定位

**B2B System** 是一套以 Web 為載體的遊戲內容編輯與管理平台。本階段（Phase 0）
**尚未實作任何編輯器本身的功能**，目標是先把「誰能做什麼」這件事一次做對——
建立一套可以被後續所有功能直接複用的 **RBAC 權限骨架**。

這個順序是刻意的。權限如果是功能上線後才補，會有兩個典型後果：

1. 權限檢查散落在各個 controller 與元件裡，沒有單一事實來源，稽核時無法回答
   「某個角色到底能做什麼」。
2. 前端 UI 的顯示/隱藏與後端的實際授權判斷各寫一套，必然發散。

因此 Phase 0 的產出不是「一個有登入功能的空殼」，而是 **一組會被強制使用的機制**：
後端有 `@RequirePermissions()` guard，前端有頁面權限註冊表，兩邊共用同一份
由後端產生的權限鍵（`PermissionKey`）。

---

## 2. 首期範圍（Phase 0）

### 2.1 In scope

| 領域       | 內容                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 認證       | 登入、登出、Access Token 續期（rotating refresh token）、忘記密碼／重設密碼、首次啟用設定密碼 |
| SSO（Phase 0 之後加入） | `apps/auth` 身分與租戶入口、`apps/api` 當 OIDC Provider、外部 IdP（OIDC）與網域導向、單一登出（[`architecture/04-sso.md`](../architecture/04-sso.md)） |
| 租戶（Phase 0 之後加入） | 每個租戶一個 database 與網域；平台管理者在 apps/auth 建立、佈建、停用、刪除租戶，管理平台管理者、平台稽核與全平台的背景工作（[`architecture/05-tenancy.md`](../architecture/05-tenancy.md)） |
| 使用者管理 | 列表（分頁／搜尋／排序）、建立、檢視、編輯、停用／啟用、刪除、指派角色                        |
| 角色管理   | 列表、建立、檢視、編輯、刪除、授予／移除權限、系統角色保護                                    |
| 群組（Phase 0 之後加入） | 純分組：巢狀成員、群組持有角色、資料夾授權給群組；加成員受反提權限制、群組不能持有 super-admin（[`rbac/08-groups.md`](../rbac/08-groups.md)、[ADR-0024](../adr/0024-relationship-based-access-control.md) D10～D16） |
| 授權的說明（Phase 0 之後加入） | 有效權限的來源、資料夾存取的路徑；查自己不需要權限、查別人要 `authz:explain`，看不到的節點只顯示種類（[`rbac/09-explain.md`](../rbac/09-explain.md)、ADR-0024 D14） |
| 權限目錄   | 唯讀的權限清單 API 與 UI（resource × action），供角色編輯時挑選                               |
| 個人帳號   | 個人資料檢視／編輯、變更密碼、偏好設定（語系、時區）                                          |
| 稽核日誌   | 所有寫入操作與授權決策的記錄、列表與篩選                                                      |
| 系統設定（Phase 0 之後加入） | 每個租戶執行期可調的帳號政策、上傳上限、預設時區（[`architecture/backend/12-settings.md`](../architecture/backend/12-settings.md)） |
| 回收桶與版本歷史（Phase 0 之後加入） | 編輯的樂觀鎖（`version` 必填）；使用者、角色、檔案與資料夾刪除後進回收桶、保留期限內可還原、到期永久刪除；角色的版本紀錄與還原到某一版（[`architecture/backend/13-trash.md`](../architecture/backend/13-trash.md)、[`architecture/backend/14-revisions.md`](../architecture/backend/14-revisions.md)） |
| 站內通知（Phase 0 之後加入） | 每位收件人一筆、在業務交易內寫入；審批待審／結果、角色被指派或移除；頂列鈴鐺與未讀數、列表頁、全部已讀、保留清理（[`architecture/backend/15-notification.md`](../architecture/backend/15-notification.md)、[`architecture/frontend/15-notification.md`](../architecture/frontend/15-notification.md)） |
| 前端骨架   | App Shell、側邊選單（依權限過濾）、路由守衛、錯誤頁、i18n、主題                               |

### 2.2 Out of scope（Phase 0 明確不做）

- 遊戲編輯器本身的任何功能（關卡、資源、腳本、預覽…）
- **資源層級作用域**（例如「只能編輯自己專案的資源」）
  — 架構已預留延伸點，理由見 [ADR-0006](../adr/0006-flat-permission-scope.md)
- LDAP、SAML 整合（OIDC 的 SSO 已在 Phase 0 之後加入，見 [`architecture/04-sso.md`](../architecture/04-sso.md)）
- MFA（雙因素驗證）— 資料表預留欄位，流程不實作
- 批次匯入／匯出
- Webhook（站內通知已在 Phase 0 之後加入，見上表）

---

## 3. 使用者角色

| 角色       | slug          | 描述                                                                                   | 預設權限                                                     |
| ---------- | ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 超級管理員 | `super-admin` | 系統唯一的最高權限帳號，由初始化流程建立。**繞過所有權限檢查**，不可刪除、不可移除權限 | 全部（隱含）                                                 |
| 系統管理員 | `admin`       | 管理使用者、角色與權限的日常管理者                                                     | `user:*`、`role:*`、`permission:read`、`auditLog:read`       |
| 唯讀稽核   | `auditor`     | 只能看，不能改。供稽核與客服使用                                                       | `user:read`、`role:read`、`permission:read`、`auditLog:read` |
| 一般成員   | `member`      | 未來編輯器功能的使用者。Phase 0 只能看自己的帳號頁                                     | 無（僅個人頁面）                                             |

上述四個角色是 **系統角色（`is_system = true`）**：不可刪除、不可改名。
`admin` / `auditor` / `member` 的權限可被超級管理員調整；`super-admin` 不可調整。

---

## 4. 使用者故事

### 4.1 認證

**作為一名使用者，我希望用帳號密碼登入，以便進入系統。**

- **Given** 我持有一組已啟用的帳號
- **When** 我在登入頁輸入正確的 email 與密碼並送出
- **Then** 系統核發一組短期 Access Token（存在記憶體）與一組 Refresh Token（`httpOnly` cookie）
- **And** 前端向 `GET /auth/profile` 取得我的身分與 **扁平化的權限鍵集合**
- **And** 我被導向首頁，側邊選單只列出我有權限進入的項目

**作為一名使用者，我希望連續操作時不會突然被登出，以便專心工作。**

- **Given** 我的 Access Token 即將到期（剩餘 < 30 秒）
- **When** 我發出任何需要認證的請求
- **Then** 前端會先以 Refresh Token 續期再送出請求，過程對我無感
- **And** 多個分頁同時操作時，只有一個分頁實際執行續期，其他分頁沿用結果

**作為一名使用者，我希望登出後我的 Token 立刻失效，以便保障帳號安全。**

- **Given** 我已登入
- **When** 我點擊登出
- **Then** 後端撤銷這條 Refresh Token 家族，前端清除記憶體中的 Access Token 與所有快取

### 4.2 角色與權限

**作為系統管理員，我希望建立角色並授予權限，以便用職責而非個人來管理授權。**

- **Given** 我有 `role:create` 權限
- **When** 我建立一個角色並勾選要授予的權限
- **Then** 我 **只能勾選我自己持有的權限**（反提權保護）
- **And** 角色建立成功後立即可指派給使用者

**作為系統管理員，我希望調整角色權限後立刻生效，以便快速回應風險。**

- **Given** 某使用者持有角色 R，R 原本有 `user:delete`
- **When** 我從 R 移除 `user:delete`
- **Then** 該使用者的下一次請求（最遲 60 秒內，見 [`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §5）即被拒絕
- **And** 該使用者重新整理頁面後，UI 上的刪除按鈕消失

**作為系統管理員，我希望系統角色不會被誤刪，以便系統永遠有人管得動。**

- **Given** 角色 `super-admin` 是系統角色
- **When** 我嘗試刪除它或修改它的權限
- **Then** 後端回 `403 ROLE_SYSTEM_PROTECTED`，前端不提供該操作入口

### 4.3 稽核

**作為稽核人員，我希望查到每一次權限變更的紀錄，以便追溯責任。**

- **Given** 我有 `auditLog:read` 權限
- **When** 我進入稽核日誌頁並以「資源類型 = 角色」篩選
- **Then** 我看到每一筆角色建立／修改／刪除／授權變更，含操作者、時間、前後值差異、來源 IP

---

## 5. 非功能需求

| 項目             | 目標                                                     |
| ---------------- | -------------------------------------------------------- |
| 授權判斷延遲     | Guard 端到端 < 5 ms（權限集合命中快取時）                |
| 權限變更生效時間 | ≤ 60 秒（快取 TTL），明確失效事件 < 1 秒                 |
| 前端首屏         | 登入頁 LCP < 1.5 s（本地建置產物 + gzip）                |
| 語系             | zh-TW（預設）、en-US，語系包隨 feature 分包載入          |
| 瀏覽器           | 最新兩個版本的 Chrome / Edge / Firefox / Safari          |
| Node             | >= 24（`.nvmrc`；`@sigrea/core` 的最低要求）             |
| 稽核保存         | 稽核日誌不可修改、不可刪除（append-only），保留 ≥ 365 天 |

---

## 6. 名詞定義

| 名詞                           | 定義                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| **Permission（權限）**         | 一個不可再分的動作許可，鍵格式為 `resource:action`，例如 `role:update`      |
| **Permission Key**             | 權限的字串識別碼，由後端定義、透過 OpenAPI 傳遞給前端，兩端共用             |
| **Role（角色）**               | 一組權限的具名集合                                                          |
| **System Role（系統角色）**    | `is_system = true` 的角色，受刪除與改名保護                                 |
| **Subject（主體）**            | 被授權的對象，Phase 0 只有 `User`                                           |
| **Permission Set（權限集合）** | 某使用者透過其所有角色間接持有的權限鍵扁平集合                              |
| **反提權（Anti-escalation）**  | 一個人不能授予他自己沒有的權限                                              |
| **Page Key**                   | 前端「一個受管頁面」的識別碼，由 feature 自行鑄造並註冊到 `core/permission` |
| **Token Family**               | 一條 Refresh Token 的輪替鏈，重用舊 Token 會使整個家族失效                  |

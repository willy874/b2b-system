# 專案總覽

這份文件回答三件事：B2B System 是什麼、它提供哪些能力、誰在用它。
想看畫面，讀 [`05-feature-tour.md`](./05-feature-tour.md)；想知道每個機制替哪些邊際情況想過答案，讀 [`04-introduction.md`](./04-introduction.md)。

---

## 1. 定位

**B2B System 是一套通用型的多租戶 B2B 後台骨架。** 它不綁定任何業務領域：訂單、內容、專案、工單……
只要是「一群職責不同的人，在同一個組織裡管理資料」的系統，都可以把業務功能加在它上面。

它的價值不在某個業務功能，而在 **每個後台都會重寫一次、又最容易寫錯的那一層**。業務功能以 feature（前端）＋ module（後端）的形式加上去，
直接拿到下表右欄的東西：

| 能力 | 業務功能拿到的是什麼 |
| --- | --- |
| 身分與租戶 | 不用自己做登入、SSO、多租戶隔離；每個請求已經知道「哪個租戶的哪個人」 |
| 權限 | 宣告權限鍵，就有後端 guard、選單過濾、反提權與「為什麼能做 X」的說明；需要資源層級的授權時，掛在同一張關係圖上 |
| 稽核 | 在業務交易內記一筆，稽核頁就查得到前後差異 |
| 資料保護 | 樂觀鎖、回收桶、版本歷史以「註冊」的方式套到新實體 |
| 非同步 | 背景工作、排程、寄信都有交易安全的入口 |
| 溝通 | 站內通知、公告、Webhook 有現成的類型登記與投遞 |
| 對外整合 | 服務帳號、API token、獨立程序的對外 API（`/v1`） |

### 1.1 先把「誰能做什麼」做對

開發順序是刻意的：先做 RBAC 骨架（Phase 0），再補上上表的通用機制，最後才是業務功能。權限如果是功能上線後才補，有兩個典型後果：

1. 權限檢查散落在各個 controller 與元件，沒有單一事實來源，稽核時答不出「某個角色到底能做什麼」。
2. 前端的顯示／隱藏與後端的實際授權各寫一套，必然發散。

所以骨架的產出是 **一組會被強制使用的機制**：每個路由沒宣告授權方式，程序就啟動失敗；
前端有頁面權限註冊表；兩邊共用同一份由後端產生的權限鍵（`PermissionKey`）。

---

## 2. 系統組成

| 應用 | 給誰用 | 做什麼 |
| --- | --- | --- |
| `apps/backstage` | 租戶的使用者 | 管理後台：人員、權限、檔案、稽核、通知……，以及之後的業務功能 |
| `apps/platform` | 平台管理者；所有人的登入入口 | 全平台共用的登入互動頁（OIDC），以及租戶、平台管理者、feature flag 的管理 |
| `apps/api` | 前兩者 | REST API、OIDC Provider、背景工作、WebSocket；另以獨立程序提供對外 API（`/v1`，只認 API token） |
| `apps/file-storage` | 開發環境 | S3 相容的本機物件儲存 |

身分分兩個範圍：租戶的 `users`（登入 backstage）與平台的 `platform_admins`（登入 apps/platform）。同一個 email 在兩邊是兩個帳號。
每個租戶有自己的 database 與網域，請求由網域決定租戶。見 [`architecture/01-system.md`](../architecture/01-system.md)、
[`architecture/04-sso.md`](../architecture/04-sso.md) §1.1、[`architecture/05-tenancy.md`](../architecture/05-tenancy.md)。

---

## 3. 能力地圖

每一列是一組已經上線的能力。「導覽」連到 [`05-feature-tour.md`](./05-feature-tour.md) 的畫面，「規格」連到單一事實來源。

### 3.1 身分與存取

| 能力 | 內容 | 導覽 | 規格 |
| --- | --- | --- | --- |
| 登入與 SSO | apps/platform 的登入互動頁、外部 IdP（OIDC）與網域導向、單一登出、忘記密碼、啟用信、註冊申請 | [§1](./05-feature-tour.md#1-登入) | [`04-sso.md`](../architecture/04-sso.md)、[`backend/04-auth.md`](../architecture/backend/04-auth.md) |
| 使用者 | 列表（搜尋、排序、篩選、跨頁選取）、建立、編輯、停用、解鎖、重設密碼、指派角色、批次操作 | [§2.1](./05-feature-tour.md#21-使用者) | [`iam/04-api.md`](../architecture/iam/04-api.md) |
| 角色 | 建立、複製、權限技能樹、系統角色保護、版本紀錄與還原 | [§2.2](./05-feature-tour.md#22-角色) | [`iam/01-model.md`](../architecture/iam/01-model.md) |
| 群組 | 巢狀成員、群組持有角色、資料夾授權給群組 | [§2.3](./05-feature-tour.md#23-群組) | [`iam/07-groups.md`](../architecture/iam/07-groups.md) |
| 權限目錄與說明 | 唯讀權限清單與依賴樹；有效權限的來源路徑 | [§2.4](./05-feature-tour.md#24-權限目錄與有效權限) | [`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md)、[`iam/08-explain.md`](../architecture/iam/08-explain.md) |
| 服務帳號與 API token | 個人與服務帳號的 token（scopes、到期、撤銷）、對外 API | [§2.5](./05-feature-tour.md#25-服務帳號與-api-token) | [`06-external-api.md`](../architecture/06-external-api.md) |
| 審批 | 申請 → 核准 → 套用；核准等同代為執行、四眼原則 | [§3.2](./05-feature-tour.md#32-審批) | [`backend/20-approval.md`](../architecture/backend/20-approval.md) |

### 3.2 資料與內容

| 能力 | 內容 | 導覽 | 規格 |
| --- | --- | --- | --- |
| 檔案 | S3 直傳、分塊上傳、影像變體、檔案管理器、資料夾層級的授權與繼承 | [§3.1](./05-feature-tour.md#31-檔案管理器) | [`backend/09-file.md`](../architecture/backend/09-file.md)、[`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md) |
| 標籤 | 依資源類型分開的標籤組、列表依標籤篩選 | [§3.3](./05-feature-tour.md#33-標籤) | [`backend/18-tag.md`](../architecture/backend/18-tag.md) |
| 稽核日誌 | 所有寫入與授權決策；前後差異；熱冷分層 | [§4.1](./05-feature-tour.md#41-稽核日誌) | [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) |
| 回收桶與版本歷史 | 樂觀鎖（`version` 必填）、刪除後可還原、到期永久刪除、角色的版本差異與還原 | [§4.2](./05-feature-tour.md#42-回收桶與版本紀錄) | [`backend/13-trash.md`](../architecture/backend/13-trash.md)、[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) |

### 3.3 非同步與溝通

| 能力 | 內容 | 導覽 | 規格 |
| --- | --- | --- | --- |
| 背景工作與寄信 | pg-boss 佇列、排程、重試與管理頁；交易內入列（outbox）；郵件範本 | [§4.3](./05-feature-tour.md#43-背景工作) | [`backend/10-jobs.md`](../architecture/backend/10-jobs.md)、[`backend/11-mail.md`](../architecture/backend/11-mail.md) |
| 站內通知 | 鈴鐺與未讀數、列表、全部已讀、通知總覽；事件的租戶開關與個人設定 | [§5.1](./05-feature-tour.md#51-站內通知) | [`backend/15-notification.md`](../architecture/backend/15-notification.md)、[`backend/16-notification-event.md`](../architecture/backend/16-notification-event.md) |
| 公告 | 發給人、群組、角色或全體；立即、指定時間、週期、事件點；已讀率與撤回 | [§5.2](./05-feature-tour.md#52-公告) | [`backend/19-announcement.md`](../architecture/backend/19-announcement.md) |
| Webhook | 對外事件、HMAC 簽章、投遞與重試、連續失敗自動停用、重送；SSRF 防護 | [§5.3](./05-feature-tour.md#53-webhook) | [`backend/17-webhook.md`](../architecture/backend/17-webhook.md) |
| 即時推播 | 權限、通知、資料變更推到瀏覽器；只有一個分頁持有連線 | — | [`backend/08-realtime.md`](../architecture/backend/08-realtime.md)、[`frontend/11-realtime.md`](../architecture/frontend/11-realtime.md) |

### 3.4 租戶與平台

| 能力 | 內容 | 導覽 | 規格 |
| --- | --- | --- | --- |
| 系統設定 | 每個租戶執行期可調的帳號政策、上傳上限、預設時區 | [§4.4](./05-feature-tour.md#44-系統設定與外部-idp) | [`backend/12-settings.md`](../architecture/backend/12-settings.md) |
| 租戶管理 | 建立、佈建、停用、刪除；網域；功能開關與配額 | [§6.1](./05-feature-tour.md#61-租戶) | [`05-tenancy.md`](../architecture/05-tenancy.md) |
| 平台管理 | 平台管理者、平台稽核、全平台的背景工作、feature flag | [§6.2](./05-feature-tour.md#62-平台管理者feature-flag-與平台稽核) | [`05-tenancy.md`](../architecture/05-tenancy.md) §11 |
| 個人帳號 | 個人資料、變更密碼、語系、時區、主題、通知設定 | [§7](./05-feature-tour.md#7-個人帳號與介面) | [`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) |
| 命令面板 | ⌘K／Ctrl+K：跳到頁面、最近造訪、搜尋使用者、角色、群組、檔案等資料、建立的捷徑；依權限過濾，兩個前端都有 | — | [`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) |
| 監控 | api 的指標（Prometheus）與 tracing（OpenTelemetry → Tempo）、就緒檢查；Grafana 的儀表板與告警（api、容量與資料庫、背景工作、前端的錯誤與 Web Vitals） | — | [`08-monitoring.md`](../architecture/08-monitoring.md) |
| 前端可觀測性 | 兩個前端的錯誤回報（送到模擬 Sentry API 的 apps/apm-service，以 sourcemap 還原堆疊）、錯誤頁的「複製錯誤資訊」、Web Vitals、CI 的 bundle 預算 | — | [`frontend/19-observability.md`](../architecture/frontend/19-observability.md)、[`07-apm-service.md`](../architecture/07-apm-service.md) |

### 3.5 不在範圍

- 任何特定領域的業務功能——本 repo 只提供骨架。
- LDAP、SAML（OIDC 的外部 IdP 已支援）。
- 還沒做、但已有提案的功能（匯入匯出、留言與關注、MFA、多階段審批、自訂欄位、方案與用量、SCIM 等）列在
  [`features/README.md`](../features/README.md)。

---

## 4. 角色

### 4.1 租戶的系統角色

以下四個是 **系統角色（`is_system = true`）**：不可刪除、不可改名。完整的權限清單在
[`apps/api/src/db/seeds/roles.ts`](../../apps/api/src/db/seeds/roles.ts) 與 [`iam/05-bootstrap.md`](../architecture/iam/05-bootstrap.md)。

| 角色 | slug | 用途 | 權限 |
| --- | --- | --- | --- |
| 超級管理員 | `super-admin` | 每個租戶的最高權限，由初始化或佈建建立 | 隱含全集（一條 `superAdmin` 邊，不列權限鍵）；不可調整 |
| 系統管理員 | `admin` | 日常管理者 | 人員、角色、群組、檔案、審批、背景工作、外部 IdP、服務帳號、Webhook、標籤、公告的管理 |
| 稽核人員 | `auditor` | 稽核與客服：只能看，不能改 | 上述資源的 `read`、稽核日誌、`authz:explain` |
| 一般成員 | `member` | 業務功能的一般使用者 | 只有 `file:access`：進得了檔案管理器，範圍由資料夾授權決定 |

`admin`、`auditor`、`member` 的權限可以調整，但受反提權限制：任何人都不能授予自己沒有的權限。

### 4.2 平台角色

平台管理者的角色固定三種，權限不存資料庫（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8）：

| 角色 | 用途 |
| --- | --- |
| `super-admin` | 全部，包含管理其他平台管理者 |
| `operator` | 建立與調整租戶（不能刪除）、重試背景工作、緊急關閉 feature flag |
| `auditor` | 唯讀 |

---

## 5. 核心使用者故事

完整的流程與錯誤碼在 [`iam/03-flows.md`](../architecture/iam/03-flows.md)；E2E 涵蓋的情境在 [`frontend/10-testing.md`](../architecture/frontend/10-testing.md) §4.1。

**作為管理者，我希望調整角色權限後立刻生效，以便快速回應風險。**

- **Given** 使用者持有角色 R，R 原本有 `user:delete`
- **When** 我從 R 移除 `user:delete`
- **Then** 他的下一次請求就被拒絕（主動失效不到 1 秒；跨程序的廣播漏掉時，最遲在快取 TTL 60 秒後）
- **And** 他停在頁面上不重新整理，推播也會讓刪除按鈕消失；若推播漏掉，下一次操作收到 403 後畫面自我修正

**作為管理者，我希望只能授予我自己持有的權限，以便權限不會被層層放大。**

- **Given** 我有 `role:grantPermission`，但沒有 `system:update`
- **When** 我嘗試把 `system:update` 加進某個角色
- **Then** 技能樹上這個權限標成「無法授予」；直接打 API 回 `403 AUTHZ_ESCALATION`
- **And** 同一條規則也套在指派角色、加群組成員、資料夾授權、還原與審批核准上

**作為一般成員，我希望打開別人傳來的網址時知道自己缺權限，以便請人開通。**

- **Given** 我只有 `member` 角色
- **When** 我打開 `/role/create`
- **Then** 登入後回到原網址，顯示 403 而不是被導回首頁；選單只列出我看得到的項目

**作為稽核人員，我希望查到每一次權限變更，以便追溯責任。**

- **Given** 我有 `auditLog:read`
- **When** 我以「資源類型 = 角色」篩選稽核日誌
- **Then** 每一筆建立、修改、刪除、授權變更都有操作者、時間、前後差異與來源 IP；即使操作者後來被刪除，紀錄仍看得懂

---

## 6. 非功能需求

| 項目 | 目標 |
| --- | --- |
| 授權判斷 | 權限快取命中時 < 1 ms；每個請求都在伺服器解析，權限不進 token |
| 權限變更生效 | 主動失效 < 1 秒；漏掉廣播時最遲 60 秒（快取 TTL） |
| 租戶隔離 | 每個租戶一個 database 與 DB 角色；沒有租戶脈絡時直接拋錯 |
| 稽核 | append-only（DB 角色只有 INSERT／SELECT、trigger 擋 UPDATE／DELETE）；熱表 90 天、之後搬到壓縮的冷表 |
| 語系 | zh-TW（預設）、en-US；語系包隨 feature 分包載入，兩個語系的鍵集合由測試比對 |
| 主題 | 淺色與深色；兩個主題都通過 WCAG 對比測試 |
| 瀏覽器 | 最新兩個版本的 Chrome、Edge、Firefox、Safari |
| 執行環境 | Node ≥ 24、PostgreSQL 17 |

---

## 7. 名詞

| 名詞 | 定義 |
| --- | --- |
| **租戶（Tenant）** | 一個使用本系統的組織；有自己的 database、網域與 bucket |
| **Permission（權限）** | 不可再分的動作許可，鍵格式 `resource:action`，例如 `role:update` |
| **Permission Key** | 權限的字串識別碼，由後端定義、經 OpenAPI 傳給前端 |
| **Role（角色）** | 一組權限的具名集合 |
| **System Role（系統角色）** | `is_system = true` 的角色，受刪除與改名保護 |
| **Group（群組）** | 一組使用者或子群組；可以持有角色、被授權資料夾 |
| **Subject（主體）** | 被授權的對象：使用者或群組；服務帳號是 `kind = 'service'` 的使用者 |
| **Relation Tuple** | 關係圖上的一條邊（`物件#關係@主體`）；角色持有、角色的權限鍵、群組成員、資料夾授權都是 tuple |
| **有效權限（Permission Set）** | 某主體經由所有路徑（角色、群組、上層群組）持有的權限鍵扁平集合 |
| **反提權（Anti-escalation）** | 把主體放進某個關係時，主體因此取得的能力，操作者必須全部都有 |
| **Page Key** | 前端「一個受管頁面」的識別碼，由 feature 在 plugin 同步階段註冊 |
| **Feature** | 前端的一個功能資料夾；可由平台管理者對單一租戶開關，關掉時 API 回 `404 FEATURE_DISABLED`、前端卸載 |
| **Feature Flag** | 暫時的開關，必填 `removeBy`，過期未移除會讓測試失敗 |
| **Token Family** | 一條 refresh token 的輪替鏈；拿出早已用過的 token 會撤銷整條 |

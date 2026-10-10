# 平台危險操作的雙人覆核（four-eyes）

- 優先度：P2
- 狀態：提案
- 依賴：平台的權限目錄與稽核（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8、[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D5、D19）；
  平台通知（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §6.2，`modules/platform-notification`）；
  概念沿用租戶的審批（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §3、§4）
- 相關：[`tenant-lifecycle.md`](./tenant-lifecycle.md)（「排程清除立即執行」是候選操作）、[`support-access.md`](./support-access.md)（開啟支援存取是候選操作）、
  [`tenant-user-support.md`](./tenant-user-support.md)（重設租戶使用者的 MFA）、[`platform-security-policy.md`](./platform-security-policy.md)（改安全政策本身）、
  [`platform-dashboard.md`](./platform-dashboard.md)（總覽列出「待我核准」）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

apps/platform 的高風險操作現在都是 **一個人按一下就生效**，唯一的防線是角色（多數只給 `super-admin`）與確認框：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 刪除租戶 | `DELETE /platform/tenants/:id`（`tenant:delete`）：停用、撤銷所有 session、標記刪除、釋出網域（[`05-tenancy.md`](../architecture/05-tenancy.md) §5） | 沒有還原的端點；網域釋出後可能立刻被別的租戶登記。按錯人或被盜用的帳號一次就造成事故 |
| 清空 CDN 快取 | `POST /platform/cdn/purge`，`target.type = 'all'` 另要 `cdn:purgeAll`（`CdnManualPurgeService` 在 service 檢查） | 所有圖片回源，源站負載升高（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.11） |
| 重設平台管理者的 MFA | `POST /platform/admins/:id/mfa/reset`（`platformAdmin:resetMfa`，[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §8） | 搭配外洩的密碼，一個被盜的 super-admin 可以拆掉另一位的 MFA 再登入他的帳號 |
| 換平台管理者的角色、新增 super-admin | `PATCH`／`POST /platform/admins`（`platformAdmin:update`／`create`） | 一個帳號被盜就能自己長出第二個 super-admin，之後的稽核都追不回「誰同意過」 |
| 之後的提案 | 排程清除的「立即執行」、開啟支援存取、改平台的安全政策 | 每份提案都得各自想「要不要兩個人」，做法會不一致 |

租戶已有審批（[`backend/20-approval.md`](../architecture/backend/20-approval.md)：申請 → 核准 → 套用、四眼 §3.3、handler 由擁有者模組註冊 §4），但它完全綁在租戶：
`ApprovalService` 用 `TENANT_DB`、租戶的 `AuditService`、`NotificationService`、`PermissionService`（關係圖的權限），申請人與審核者是租戶的 `users`。
`core/` 沒有任何審批的抽象，平台不能直接注入它。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 平台版的請求 → 核准 → 執行：資料在平台 DB，對象是 `platform_admins` | 多階段、會簽、條件分流（租戶審批 §9 的流程）；平台只有一關 |
| 申請人不能自己核准；核准者也必須做得到原操作（同 [`20-approval.md`](../architecture/backend/20-approval.md) §3.2「核准等同代為執行」） | 依金額或數量分級（例：清理 1000 筆以上才要覆核） |
| 請求有效期、到期作廢；核准時重新檢查前提 | 核准後排程到指定時間才執行 |
| 第一批操作：刪除租戶、清空 CDN 快取、重設平台管理者的 MFA、換平台管理者的角色、新增 super-admin | 租戶網域內的操作（那是租戶審批的範圍） |
| 擁有者模組註冊 handler；之後的提案只要註冊一個 handler 就受保護 | 對外 API、CLI 走覆核（CLI 是退路，見開放問題 4） |
| 平台稽核、平台通知、apps/platform 的請求列表與詳情；原按鈕改成「送出申請」 | 簡訊、Telegram 等外部管道提醒審核者 |
| 只有一位能核准的人時的退路（開放問題 4） | |

## 使用者故事

**作為平台的 super-admin，我希望刪除租戶要另一位管理者核准，以便一個被盜或按錯的帳號不能單獨刪掉客戶。**

- **Given** 平台有兩位啟用中的 super-admin：A 與 B
- **When** A 在租戶詳情按「申請刪除」，填理由送出
- **Then** 租戶不變，詳情頂端顯示「A 已申請刪除，等待核准（〈到期時間〉前有效）」；B 收到平台通知；平台稽核記 `platformApproval.submit`

**作為核准者，我希望核准時系統再檢查一次前提，以便不會執行一個已經過時的申請。**

- **Given** A 申請「把 C 的角色從 `operator` 改成 `super-admin`」之後，另一位管理者已把 C 停用
- **When** B 按「核准」
- **Then** 回 `409 PLATFORM_APPROVAL_STALE`，請求改成 `stale`、不執行；詳情說明「送出後 C 的狀態已改變」；A 收到通知

**作為唯一的 super-admin，我希望在沒有第二個人時仍有退路，以便覆核不會把平台鎖死。**

- **Given** 平台只有一位啟用中的 super-admin（剛建立的部署）
- **When** 他按「清空 CDN 快取」
- **Then** 依開放問題 4 的結論：直接執行並寫 `high` 稽核、或提示用 CLI；絕不會出現一筆永遠沒人能核准的請求

**作為申請人，我希望能撤回還沒被核准的申請，以便按錯時自己收回。**

- **Given** 我送出的申請還在 `pending`
- **When** 我按「撤回」
- **Then** 請求改成 `withdrawn`，待審者的通知標示已撤回，同一個對象可以重新申請

## 初步構想

### 1. 第一批操作與前提

| 動作（`action`） | 原端點與權限 | 去重鍵（`subject_key`） | 核准時重驗的前提 |
| --- | --- | --- | --- |
| `tenant.delete` | `DELETE /platform/tenants/:id`（`tenant:delete`） | 租戶 id | 租戶未刪除、狀態不是 `provisioning`（`PlatformTenantService.remove` 的檢查） |
| `cdn.purgeAll` | `POST /platform/cdn/purge` `all`（`cdn:purge` ＋ `cdn:purgeAll`） | 固定值 `all` | 環境變數層有 CDN、沒有尚未完成的 `all`（`CDN_PURGE_IN_PROGRESS`） |
| `platformAdmin.resetMfa` | `POST /platform/admins/:id/mfa/reset`（`platformAdmin:resetMfa`） | 管理者 id | 對象仍存在、有 MFA；核准者不是對象本人（`AUTHZ_SELF_MODIFY`） |
| `platformAdmin.changeRole` | `PATCH /platform/admins/:id` 帶 `role`（`platformAdmin:update`） | 管理者 id | 對象的 `role`、`status` 與送出時相同；降級不是最後一位 super-admin（`LAST_SUPER_ADMIN`，[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §8.2） |
| `platformAdmin.createSuperAdmin` | `POST /platform/admins` 且 `role = 'super-admin'`（`platformAdmin:create`） | 小寫 email | email 仍沒被使用 |

改名、停用、建立 `operator`／`auditor`、`cdn:update` 的關閉 **不覆核**：事故時要立刻做得到（[`backend/09-file.md`](../architecture/backend/09-file.md) §17.1 D5 的理由）。
後續提案（立即清除、支援存取、安全政策、跨租戶重設 MFA）各自註冊 handler，見開放問題 3。

### 2. 資料模型（平台 DB）

`platform_approval_requests`：

| 欄位 | 說明 |
| --- | --- |
| `action` | 上表的動作，對應一個 handler |
| `status` | `pending` → `executing` → `executed` ｜ `failed`；或 `rejected`／`withdrawn`／`expired`／`stale` |
| `subject_key` | `UNIQUE (action, subject_key) WHERE status IN ('pending','executing')`：同一個對象同時只有一筆 |
| `payload` | 原操作的參數與名稱快照（租戶代碼、對象的 email），列表與通知直接顯示 |
| `precondition` | 送出時的前提快照（例：`{ role, status }`），核准時由 handler 比對 |
| `requester_id`／`requester_email`、`reason` | 申請人與理由（理由必填） |
| `reviewer_id`／`reviewer_email`、`review_comment`、`reviewed_at` | 核准或駁回的人 |
| `expires_at` | 有效期限；過了由背景工作改成 `expired` |
| `executed_at`、`result`、`error_code` | 執行的結果（例：`cleanupFailed`、`jobIds`） |
| `version` | 撤回、核准、駁回都要帶（[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11） |

`platform_admins`、`tenants` 都 **沒有 `version` 欄**，所以前提不能靠「對象的 version 沒變」，要由 handler 自己快照與比對（開放問題 6）。

### 3. 後端：`modules/platform-approval`（新）

- `PlatformApprovalHandler`：`action`、`requiredPermissions(payload)`（等同直接執行所需）、`snapshot(payload)`、`assertExecutable(request)`（比對前提，不成立拋 `PLATFORM_APPROVAL_STALE`）、
  `execute(request, approver)`、`summarize(payload)`、`link(payload)`。擁有者模組（`tenant`、`platform-cdn`、`platform-admin`、`mfa`）在 `onModuleInit` 註冊，
  `PlatformApprovalModule` 是葉節點，與 `ApprovalHandlerRegistry` 同一個形狀。
- **執行不能放進核准的同一個交易**：`PlatformTenantService.remove` 先停用、在交易外收尾（撤銷 session、IdP、連線池），最後才在交易內標記刪除；清空快取是入列工作。
  所以順序是 ① 交易外檢查（pending、四眼、權限、有效期、前提）② 交易：`UPDATE … SET status='executing' WHERE id=? AND status='pending' AND version=?`（0 列 → `PLATFORM_APPROVAL_ALREADY_REVIEWED`）＋ 稽核 `platformApproval.approve`
  ③ `handler.execute()` 呼叫擁有者原本的 service 方法（原動作的稽核照舊寫，`actor` 是核准者，`metadata.approvalRequestId` 與申請人）④ 寫回 `executed`／`failed` 與結果 ⑤ 通知申請人。
  程序在 ③ 中途停止時留在 `executing`：比照 `tenant.provisionSweep`，由排程改成 `failed` 並註明「執行中斷」。
- 背景工作 `platformApproval.expire`（`scope: 'platform'`、`exclusive`）：把過期的 `pending` 改成 `expired`、寫稽核、通知申請人。
- 原端點：handler 註冊後，原 service 在需要覆核時改成呼叫 `PlatformApprovalService.submit()` 並回 `202 { requestId }`（或另開端點，開放問題 7）。

### 4. 權限（平台的目錄）

| 權限鍵 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | :-: | :-: | :-: |
| `platformApproval:read` | 請求列表與詳情 | ✅ | ✅ | ✅ |
| `platformApproval:review` | 核准、駁回；另要原操作的權限（§3 的 `requiredPermissions`） | ✅ | | |

送出不需要新權限：持有原操作權限的人才看得到「送出申請」。撤回只限申請人本人。
第一批的五個動作都只有 `super-admin` 做得到，所以實際的審核者就是「另一位 super-admin」。

### 5. 稽核與通知

| 稽核動作 | 內容 |
| --- | --- |
| `platformApproval.submit`、`.withdraw`、`.reject`、`.expire`、`.stale` | `action`、`subject_key`、`payload` 的名稱快照、理由或意見 |
| `platformApproval.approve` | 同上，另記申請人；原操作自己的稽核（例：`tenant.delete`）在執行時另寫，`metadata.approvalRequestId` 連回來 |
| `platformApproval.execute` | 只在 `failed` 時寫（`error_code`）；成功看原操作的稽核 |
| `platformApproval.bypass` | 走退路直接執行時（開放問題 4），`metadata.severity: 'high'` |

`platform_audit_logs` 沒有 `severity` 欄，現行做法是放在 `metadata.severity`（`CdnManualPurgeService`、`PlatformCdnSettingsService`），這裡沿用。

平台通知（`PlatformNotificationType` 新增）：`platformApproval.pending` 給持有 `platformApproval:review` 與原操作權限、不是申請人的啟用中管理者（`notifyHolders` 只能依單一權限，要加一個依多個權限、排除申請人的版本）；
`platformApproval.result` 給申請人（核准後的執行結果、駁回、過期、前提失效）。`PlatformNotificationService.notify` 在交易外寫、失敗只記 log，與租戶「通知在業務交易內」不同；提醒性質可以接受。

### 6. API

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/platform/approvals` | `platformApproval:read` | `status`、`action`、`mine=requested\|reviewable` 篩選；伺服器分頁 |
| GET | `/platform/approvals/:id` | `platformApproval:read` | 詳情，含「目前的前提是否仍成立」的預檢結果 |
| GET | `/platform/approvals/pending-count` | `platformApproval:read` | 待我核准的數量（側欄徽章、[`platform-dashboard.md`](./platform-dashboard.md)） |
| POST | `/platform/approvals/:id/approve`、`…/reject` | `platformApproval:review`（approve 另依 handler） | 帶 `version`、`comment`；自己的申請 `403 PLATFORM_APPROVAL_SELF_REVIEW` |
| POST | `/platform/approvals/:id/withdraw` | `@Authenticated()`，service 檢查是申請人 | 帶 `version` |

錯誤碼：`PLATFORM_APPROVAL_SELF_REVIEW`、`PLATFORM_APPROVAL_ALREADY_REVIEWED`、`PLATFORM_APPROVAL_EXPIRED`、`PLATFORM_APPROVAL_STALE`、`PLATFORM_APPROVAL_PENDING`（同對象已有一筆，`details.requestId`）、`PLATFORM_APPROVAL_VERSION_CONFLICT`。

### 7. 前端（apps/platform）

- `features/platform-approval`（新）：列表（預設「待我核准」）、詳情（payload、理由、前提預檢、核准／駁回／撤回）；側欄徽章；`navigation.ts` 放在「系統管理」。
- 原按鈕的位置不變、文字改成「申請刪除」「申請清空快取」…；確認框加必填的理由欄，送出後 toast 連到請求詳情。
  資源頁（租戶詳情、管理者詳情、CDN 頁）在有待核准的請求時顯示橫幅與「撤回」，原按鈕停用並說明「已有一筆待核准」。
- 各 feature 之間經 route id 連到請求詳情（`<RouteLink to="platformApproval.detail">`），不 import 對方的元件。

### 8. 會動到的既有模組

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/modules/platform-approval`（新） | service、repository、controller、handler 註冊表、`platformApproval.expire` 與中斷的回收 |
| `modules/tenant`（`PlatformTenantService.remove`）、`modules/platform-cdn`（`CdnManualPurgeService`）、`modules/platform-admin`（`PlatformAdminManagementService.create`／`update`）、`modules/mfa`（`mfa-admin.service.ts`） | 註冊 handler；原端點改成送出申請 |
| `modules/platform-notification` | 兩種通知類型、依多個權限並排除某人的收件人查詢、`PlatformNotificationRoute` 加請求詳情 |
| `apps/api/src/db/platform` | `platform_approval_requests`（下一個平台 migration） |
| `apps/api/src/db/seeds/platform-permissions.ts`、`docs/architecture/iam/02-permission-catalog.md` §8 | `platformApproval:read`／`review` |
| `packages/error-codes`、`web-core` 的 `ERROR_MESSAGE_KEY` | §6 的錯誤碼 |
| `apps/platform/src/features/{tenant,platform-admin,cdn}` | 按鈕文字、理由欄、待核准的橫幅 |
| `apps/api/src/cli/reset-super-admin.ts` | 若退路走 CLI（開放問題 4） |

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **重用租戶的審批，還是另做平台版？**
   方案 A：把狀態機抽成 `core/approval`（儲存、稽核、通知、權限檢查都經介面注入），租戶與平台各自實作一份 adapter；
   方案 B：平台另做一個精簡的 `modules/platform-approval`，只沿用概念（四眼、去重鍵、handler 註冊、核准者要做得到）；
   方案 C：把平台請求存進某個租戶 DB——不可行，平台沒有租戶脈絡。
   傾向 B：租戶的審批已長出多階段、審核者規則、留言、匯入匯出、webhook，抽象化的成本遠大於平台需要的那一小塊；平台的執行也不能放在核准的交易內（§3），與租戶 `apply(ctx, tx)` 的形狀不同。

2. **核准之後「立即執行」還是「交給申請人執行」？** A：核准者按下就執行（§3）；B：核准只是放行，申請人在有效期內自己按「執行」（較接近 two-person rule，但多一步，也多一個過期點）。傾向 A。

3. **哪些操作要覆核：寫死還是設定？** A：寫死在 handler 註冊（有註冊就一定覆核）；B：平台 DB 的 `platform_approval_policies` 讓 super-admin 逐項開關；C：環境變數 `PLATFORM_DUAL_APPROVAL_ACTIONS`。
   B 有「被盜帳號先關掉覆核再動手」的問題，關掉覆核本身就得覆核；C 要重啟但無法從畫面繞過。傾向 A ＋ C 的總開關（部署層可整個關閉，畫面不能）。

4. **只有一位能核准的人時怎麼辦（死鎖）？** 「能核准的人」＝ 除申請人外、啟用中、持有 `platformApproval:review` 與原操作權限的管理者。
   A：沒有其他人時自動放行，直接執行並寫 `platformApproval.bypass`（`high`）；B：一律送出，只能用 CLI（`cli:reset-super-admin` 同一類的維運指令，要主機權限）執行；
   C：break-glass——申請人輸入理由並再次驗證 MFA 後自己執行，事後通知所有 super-admin。
   另一個死鎖：唯一的另一位 super-admin 被停用、或他就是被重設 MFA 的對象。傾向 A 用在「平台根本只有一位」，人數足夠但聯絡不上時走 B，不做 C（等 `stepUp` 驗證用途做出來再議，`core/mfa/mfa-method.ts` 已預留）。

5. **有效期多長、要不要可設定？** 傾向固定 24 小時（常數），`cdn.purgeAll` 縮短為 1 小時（事故當下的操作，過久就沒有意義）；不做延長。

6. **前提怎麼重驗？** `platform_admins`、`tenants` 沒有 `version`。A：handler 快照相關欄位（`role`、`status`、`deleted_at`）比對；B：替這兩張表加 `version`（順帶補上 [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 的樂觀鎖，但會動到既有的 PATCH 契約）。
   傾向 A，B 另外評估。前提不成立時是 `stale`（不可再核准）還是保持 `pending` 讓申請人修改？傾向 `stale`，要再做就重新申請。

7. **原端點的契約：** A：原端點在需要覆核時改回 `202 { requestId }`（呼叫端要分辨兩種回應）；B：原端點保留給退路與 CLI，另開 `POST /platform/approvals`（`action` ＋ 參數）讓前端送出。
   傾向 B：原端點的語意不變，handler 驗證參數；但要防止前端或腳本繞過，原端點在覆核啟用時回 `409 PLATFORM_APPROVAL_REQUIRED`。

8. **審核者要不要能「改參數再核准」？** 傾向不行，只能核准或駁回；要改就駁回後重新申請，稽核才清楚。

9. **跨租戶的操作（[`tenant-user-support.md`](./tenant-user-support.md) 的重設租戶使用者 MFA、[`support-access.md`](./support-access.md)）也走這裡嗎？** 它們由平台管理者發起、在租戶 DB 生效；
   傾向走平台的覆核（申請人與審核者都是平台管理者），執行時以 `Tenancy.runForMaintenance` 進入租戶，原操作的稽核同時寫平台與租戶兩邊。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/` 新的一份「平台的雙人覆核」（設計決策放在這份）；[`backend/20-approval.md`](../architecture/backend/20-approval.md) §1 加一句指向它，說明兩者的分界
- [`05-tenancy.md`](../architecture/05-tenancy.md) §5：刪除租戶改成經覆核；[`backend/09-file.md`](../architecture/backend/09-file.md) §16.11、[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §8：對應的操作
- `docs/architecture/iam/02-permission-catalog.md` §8：`platformApproval:*`
- [`backend/15-notification.md`](../architecture/backend/15-notification.md) §6.2：兩種平台通知類型
- [`apps/platform/README.md`](../../apps/platform/README.md) 的頁面清單

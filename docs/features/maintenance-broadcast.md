# 維護模式與平台廣播

- 優先度：P2
- 狀態：提案
- 依賴：租戶的請求與脈絡（[`05-tenancy.md`](../architecture/05-tenancy.md) §2、§3）；站內通知與事件管理（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §3、§9，[`backend/16-notification-event.md`](../architecture/backend/16-notification-event.md) §1、§3）；
  公告的分批寫入（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §5）；推播的 room 與契約（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §6、§9）；平台的權限目錄（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8）
- 相關：[`tenant-lifecycle.md`](./tenant-lifecycle.md)（唯讀停權：與本提案的唯讀共用同一個寫入限制的機制？見開放問題 5）；
  [`support-access.md`](./support-access.md)（支援存取預設唯讀：限制的是那一條 session，不是整個租戶）；
  [`platform-dashboard.md`](./platform-dashboard.md)（總覽可以列出進行中與即將開始的維護時段）；[`tenant-user-support.md`](./tenant-user-support.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

平台管理者現在沒有任何管道對租戶「說話」。具體卡在：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 週六晚上要升級資料庫，預計停機 30 分鐘 | 平台管理者私下寄信給各租戶的聯絡人 | 平台沒有租戶的聯絡名單；租戶的一般使用者完全不知道，當下只看到 `503 TENANT_UNAVAILABLE` 的錯誤頁（`apps/backstage/src/app/Layout.tsx`、`web-core` 的 `ErrorPage`） |
| 跑 migration 或搬移資料時，要避免租戶在中途寫入 | 沒有辦法；只能停用租戶（`POST /platform/tenants/:id/disable`） | 停用會撤銷所有 session、網域回 503（[`05-tenancy.md`](../architecture/05-tenancy.md) §5）；使用者連「查資料」都不行 |
| 平台的條款、新功能、安全事件要告知所有租戶的管理員 | 無 | 公告（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md)）是 **租戶自己** 發給自己的人，平台管理者不在任何租戶裡；平台通知（`modules/platform-notification`，[`backend/15-notification.md`](../architecture/backend/15-notification.md) §6.2）只寫平台 DB 的 `platform_notifications`，收件人是平台管理者自己 |
| 維護提早結束或延後 | 無 | 沒有一個地方可以改，使用者看到的仍是舊時間 |

既有程式裡的「maintenance」已經有三種意思，新功能如果也叫 maintenance 會讀不懂：

| 現有的名稱 | 意思 | 位置 |
| --- | --- | --- |
| `TENANT_UNAVAILABLE` 的 `details.reason = 'maintenance'` | migration 落後、DB 連不上（暫時性的故障）；背景工作據此交給重試 | `core/tenant/tenancy.service.ts` 的 `TenantUnavailableReason`、指標 `api_tenant_unavailable_total{reason}`（`core/metrics/instruments.ts`）、[`05-tenancy.md`](../architecture/05-tenancy.md) §2 |
| `Tenancy.runForMaintenance(id, fn)` | 不看租戶狀態進入（停用後收尾、平台端點計算） | [`05-tenancy.md`](../architecture/05-tenancy.md) §3 |
| `announcement.maintenance`、`file.maintenance`、`image.maintenance`、`gallery.maintenance` | 每日的清理與對帳工作 | 各模組（例：`modules/file/file-maintenance.service.ts`、`modules/announcement/announcement.job-types.ts`） |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 維護時段：開始、預計結束、說明、對象（全部租戶或指定租戶）、是否在期間切成唯讀；提早結束與延後 | 真正的停機頁（api 整個不在時由反向代理回的靜態頁）：屬於部署（`deploy/`），不在 api 裡 |
| backstage 頂部的橫幅：開始前多久出現、倒數、說明；期間內改成「維護中（唯讀）」；結束後消失 | 依使用者、角色挑選看得到橫幅的人（橫幅是租戶層的） |
| 唯讀：租戶網域與對外 API 的寫入一律拒絕，讀取照常；登入、續期、登出等帳號流程放行 | 自動化：deploy 腳本呼叫 API 開關唯讀（之後可以用 API token 的平台版，現在平台沒有） |
| 平台廣播：平台管理者寫一則訊息，以站內通知（可選寄信）發給各租戶的管理員或全部使用者；分批、可撤回 | 平台廣播的週期與事件點（公告已有；平台廣播先只做立即與指定時間） |
| apps/platform 的「維護與廣播」頁；平台權限、平台稽核 | 租戶自己的維護時段（租戶沒有可以維護的東西） |

## 使用者故事

**作為平台管理者，我希望預告一個維護時段，以便租戶的使用者事先知道、避開那段時間。**

- **Given** 週六 22:00～22:30 要升級資料庫，影響全部租戶
- **When** 我在 apps/platform 建立維護時段（對象「全部租戶」、提前 72 小時顯示、期間唯讀），按下發布
- **Then** 所有租戶的 backstage 在週三 22:00 起頂部出現橫幅「本週六 22:00 起維護，約 30 分鐘」，時間依使用者的時區顯示；已開著的頁面不必重新整理就出現

**作為租戶的使用者，我希望維護期間還能查資料，以便不必整段停工。**

- **Given** 維護時段開始，`readOnly = true`
- **When** 我打開使用者列表、按下「儲存」
- **Then** 列表照常顯示；儲存被拒（`TENANT_READ_ONLY`），表單旁顯示「系統維護中，暫時無法修改」與預計結束時間；橫幅改成「維護中」

**作為平台管理者，我希望維護提早完成時立刻結束唯讀，以便使用者不必等到預定時間。**

- **Given** 維護時段進行中
- **When** 我按「提早結束」
- **Then** 所有程序在幾秒內（最晚 `TENANT_CACHE_TTL`）放行寫入，橫幅消失；平台稽核記下是誰、何時結束

**作為平台管理者，我希望通知各租戶的管理員條款將要更新，以便他們在自己的後台看到並回頭查閱。**

- **Given** 三個租戶、各有 2～3 位持有指定權限的管理員
- **When** 我建立平台廣播（對象「全部租戶」、收件人「管理員」、勾選「同時寄信」），立即送出
- **Then** 每位管理員的鈴鐺多一則通知、收到一封信（連結指向自己租戶的網域）；我在廣播的詳情看到每個租戶的寫入人數與失敗的租戶

**作為租戶的管理者，我不希望平台的維護通知被同事自己關掉。**

- **Given** 事件管理頁列出 `platform.maintenanceScheduled`
- **When** 我想把它關掉
- **Then** 它標示「不能關閉」（`mandatory`）；一般的平台廣播則照 `announcement.published` 的做法，預設不允許個人關閉、但租戶可以調整

## 初步構想

### 1. 命名

既有的 `maintenance` 不改名（錯誤碼與指標的標籤已在 OpenAPI 與告警規則裡）。新功能避開這個字：

| 概念 | 暫定名稱 | 備註 |
| --- | --- | --- |
| 維護時段 | `service_windows`（平台 DB）、模組 `modules/platform-service-window` | 畫面上仍叫「維護時段」；只有程式識別字避開 |
| 唯讀 | `readOnly`；錯誤碼 `TENANT_READ_ONLY` | 與 `TENANT_UNAVAILABLE` 分開：前者是「可以讀、不能寫」，後者是「進不去」 |
| 平台廣播 | `platform_broadcasts`、`platform_broadcast_deliveries`；模組 `modules/platform-broadcast` | 與租戶的「公告」（`announcement`）區分 |

### 2. 資料模型（平台 DB）

`service_windows`：

| 欄位 | 說明 |
| --- | --- |
| `title`、`body` | 橫幅的標題與說明（純文字，≤ 120／≤ 1000）；語系見開放問題 7 |
| `scope` | `all` ｜ `tenants`；`tenant_ids uuid[]`（`scope = tenants` 時必填）。`all` 在讀取時解析，期間新建的租戶也算 |
| `notice_from` | 橫幅開始顯示的時刻（≤ `starts_at`） |
| `starts_at`、`ends_at` | 預定的期間；`ended_at` 是實際結束（提早結束、延後時改 `ends_at`） |
| `read_only` | 期間是否唯讀 |
| `status` | `draft` → `scheduled` → `ended` ｜ `canceled`；「進行中」由時間算出，不存 |
| `notify_broadcast_id` | 發布時一併建立的平台廣播（§5），沒有則 null |
| `version`、`created_by`、`updated_by`、時間戳 | 樂觀鎖；`*_by` 是 `platform_admins.id` |

`platform_broadcasts`：`title`、`body`、`scope`／`tenant_ids`（同上）、`audience`（`admins` ｜ `all`）、`channels`（`inApp`、`email`）、`kind`（`maintenance` ｜ `general`，決定通知類型，§6）、`scheduled_for`、`status`（`draft` → `scheduled` → `sending` → `sent` ｜ `revoked`）、`version`。

`platform_broadcast_deliveries`：每個租戶一列 `(broadcast_id, tenant_id)` 唯一；`status`（`pending` → `sending` → `sent` ｜ `failed` ｜ `skipped`）、`recipient_count`、`mail_count`、`error`。內容是廣播的快照，不存在租戶 DB（全文怎麼讀見開放問題 4）。

### 3. 橫幅怎麼送到前端

| 方案 | 做法 | 優點 | 缺點 |
| --- | --- | --- | --- |
| A：新端點 | `GET /service-windows/current`（租戶網域，`@Authenticated()`）回「與這個租戶有關、`notice_from ≤ now < ends_at`」的時段 | 語意清楚；不改既有 DTO；可以單獨快取 | 前端多一個請求 |
| B：併進 `/auth/profile` | `ProfileSchema`（`modules/auth/dto/auth.dto.ts`）加 `serviceWindows` | 首屏已經在等 profile；推播後重抓 profile 的路徑已存在（`tenantFeature`） | profile 是「我是誰、能做什麼」，混入平台訊息；變更時每個人重抓整份 profile（含權限） |
| C：併進 `/system/settings/public` | 回應多一個欄位 | 不必登入就讀得到 | 那是 **租戶** 的系統設定、只存純量覆寫值（[`backend/12-settings.md`](../architecture/backend/12-settings.md) §4）；平台的資料放進去破壞分層 |

傾向 A。即時更新：新增租戶側的來源 `ChangeSource.SERVICE_WINDOW`（`packages/realtime`），平台寫入後經新的領域事件推給受影響租戶的 `t:{tenantId}` room（與 `tenant.featuresChanged` 相同的做法，`realtime.listener.ts` 的 `onTenantFeaturesChanged`），前端只讓那個 query 失效。
`scope = all` 時要對每個租戶的 room 各推一次（現在沒有「所有租戶的連線」這種 room，見開放問題 3）。
時間到了（顯示 → 進行中 → 結束）**不推**：回應帶 `startsAt`、`endsAt`、伺服器時間，前端自己倒數與切換文字；只有平台管理者改了時段才推。

### 4. 唯讀

- **判斷**：`ServiceWindowState`（`core/tenant` 旁的新元件）把進行中、`read_only` 的時段整份快取在記憶體，以 `BroadcastService.channel('service_windows')` 跨程序失效，TTL 兜底（[`01-system.md`](../architecture/01-system.md) §4.4）。時段的開始與結束由時間判斷，不需要排程工作切換。
- **執行**：沿用 [`tenant-lifecycle.md`](./tenant-lifecycle.md) §2 的寫入限制（`TenantWriteGuard` ＋ `@AllowWhenReadOnly('<理由>')` 的放行標記、錯誤碼 `TENANT_READ_ONLY`），本提案只多一個限制來源 `serviceWindow`：`details` 帶 `reason: 'serviceWindow'`、`endsAt`、`windowId`。維護是暫時的，HTTP 狀態傾向 `503`（附 `Retry-After`），與唯讀停權的 `409` 不同——兩者共用錯誤碼、以狀態碼與 `details.reason` 區分，要與開放問題 5 一起定。放行清單見開放問題 6。對外 API 的程序（[`06-external-api.md`](../architecture/06-external-api.md)）套同一個 guard。
- **背景工作**：見開放問題 6；傾向照常執行（寫入來自系統，不是使用者），但平台管理者可以另外暫停佇列。
- 錯誤碼照 CLAUDE.md 的規則改 `packages/error-codes` ＋ `web-core` 的 `ERROR_MESSAGE_KEY` 與語系檔；前端的錯誤提示顯示預計結束時間。

### 5. 平台廣播：跨租戶寫入通知

照公告的分批寫入（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §5），但第一層是租戶：

1. 送出（或 `scheduled_for` 到）→ 平台工作 `platformBroadcast.dispatch`（`scope: 'platform'`）：解析對象租戶（`active` 的；`all` 依當下的登記），為每個租戶建立 `platform_broadcast_deliveries` 的列，並以 `Tenancy.run(tenantId, …)` 進入後入列租戶工作 `platformBroadcast.deliver`（`{ broadcastId }`）。
2. `platformBroadcast.deliver`（`scope: 'tenant'`）：解析收件人——`admins` 用 `PermissionService.findActiveUserIdsWithPermission()`（持有哪個權限算「管理員」見開放問題 2），`all` 用與公告 `all` 相同的條件；每 500 人一個交易呼叫 `NotificationService.notify()`，`sourceId = broadcastId`。
3. 重做安全：`notifications.source_id` 沒有外鍵，`(source_id, recipient_id)` 部分唯一（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §2.3），平台 DB 的 uuid 可以直接當來源；完成後回寫平台 DB 那一列的 `status` 與 `recipient_count`。
4. 租戶停用、刪除時租戶工作照 [`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §1.1 略過，那一列記 `skipped`；migration 落後（`reason = maintenance`）交給重試。
5. 撤回：每個租戶入列一筆工作呼叫 `NotificationService.removeBySource(broadcastId)`，推 `notification delete`（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §7）。

### 6. 通知類型與寄信

| 類型 | 用途 | 事件管理 |
| --- | --- | --- |
| `platform.maintenanceScheduled` | 維護時段發布、時間變更、取消時 | `mandatory: true`（不能關，[`backend/16-notification-event.md`](../architecture/backend/16-notification-event.md) §1.1） |
| `platform.broadcast` | 一般的平台廣播 | `defaultAllowUserOverride: false`（與 `announcement.published` 相同）；租戶能不能整個關掉見開放問題 8 |

- 擁有者是 `modules/platform-broadcast`，在 constructor 以 `NotificationEventCatalog.register()` 登記（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §9）；不掛 `feature`，租戶關掉 `announcement` 不影響它。
- 寄信：勾選 `email` 時，`deliver` 在寫入通知的同一個交易入列每人一筆 `platformBroadcast.mail`，前面先 `isChannelEnabled(KIND, 'email', tx)`；連結用 `MailService.link()`（目前租戶的主要網域，[`backend/11-mail.md`](../architecture/backend/11-mail.md) §3）。寄信量（`audience = all` × 全部租戶）與 `MAIL_JOB_OPTIONS` 的並行數見開放問題 9。

### 7. 權限（平台的目錄）

| 權限鍵 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | :-: | :-: | :-: |
| `serviceWindow:read` | 維護時段與廣播的列表、詳情、各租戶的寫入結果 | ✅ | ✅ | ✅ |
| `serviceWindow:update` | 建立、編輯、發布、提早結束、延後、取消維護時段 | ✅ | ✅ | |
| `platformBroadcast:send` | 建立、送出、撤回平台廣播 | ✅ | 開放問題 10 | |

### 8. 稽核與推播

- 平台稽核（`PlatformAuditService`，`platform_audit_logs`）：`serviceWindow.create`／`update`／`publish`／`end`／`cancel`（`read_only` 的時段開始前後的變更 `severity: high`）、`platformBroadcast.send`／`revoke`（內文只記長度）。
- 租戶的稽核：不寫（操作者不在租戶裡）；唯讀拒絕的請求不寫稽核，只計指標 `api_tenant_read_only_rejected_total`（`core/metrics/instruments.ts`，標籤不帶租戶）。
- 推播：平台側 `platform.changed` 加來源 `platformServiceWindow`、`platformBroadcast`（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §3.6）；租戶側 `serviceWindow`（§3）。

### 9. API

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET／POST | `/platform/service-windows` | `serviceWindow:read`／`:update` | 列表、建立草稿 |
| PATCH | `/platform/service-windows/:id` | `serviceWindow:update` | 必帶 `version`；進行中只能改 `ends_at`、`body` |
| POST | `/platform/service-windows/:id/publish`、`/end`、`/cancel` | `serviceWindow:update` | 發布（可一併建立 `kind = maintenance` 的廣播）、提早結束、取消 |
| GET | `/service-windows/current` | 租戶網域、`@Authenticated()` | 橫幅（§3 方案 A） |
| GET／POST | `/platform/broadcasts` | `serviceWindow:read`／`platformBroadcast:send` | 列表、建立 |
| POST | `/platform/broadcasts/:id/send`、`/revoke` | `platformBroadcast:send` | 送出、撤回 |
| GET | `/platform/broadcasts/:id/deliveries` | `serviceWindow:read` | 每個租戶的結果 |

### 10. 前端

- apps/platform：`features/service-window`（「維護與廣播」頁，側欄群組見開放問題 11）：時段的時間軸、表單（對象租戶的多選、提前顯示的時數、唯讀）、廣播與每租戶結果。
- backstage／`web-core`：頂部橫幅不屬於任何 feature，放 `web-core`（`DashboardShell` 目前只有 `children`，要加一個橫幅的插槽，`packages/ui` 也還沒有 Banner 類的元件）；查詢與推播的接法照 [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md)。
- backstage 的 `features/notification`：兩種新類型的句子與 `NOTIFICATION_EVENT_LABEL`；連結的 route id 與全文頁見開放問題 4。

### 11. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/db/platform/schema/` | `service-windows.ts`、`platform-broadcasts.ts`（下一個平台 migration） |
| `apps/api/src/modules/platform-service-window`、`platform-broadcast`（新） | controller、service、repository、工作、通知類型 |
| `apps/api/src/common/guards/` | 寫入限制的 guard 多一個來源 `serviceWindow`（guard 與 `@AllowWhenReadOnly` 由 [`tenant-lifecycle.md`](./tenant-lifecycle.md) §2 建立；本提案先做時由本提案建立） |
| `apps/api/src/core/events/domain-events.ts`、`event-relay.ts`、`modules/realtime/realtime.listener.ts`、`realtime.audience.ts` | 新事件與轉送、推到租戶 room |
| `packages/realtime` | `ChangeSource` 加 `serviceWindow`、`platformServiceWindow`、`platformBroadcast` |
| `packages/error-codes`、`packages/web-core`（錯誤訊息、橫幅、`DashboardShell`） | `TENANT_READ_ONLY` 等錯誤碼 |
| `apps/api/src/db/seeds/platform-permissions.ts`、`docs/architecture/iam/02-permission-catalog.md` §8、apps/platform 兩個語系檔 | 平台權限鍵 |
| `docs/architecture/05-tenancy.md` | 唯讀與 `TENANT_UNAVAILABLE` 的區分 |

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **命名**：`service_window`／`readOnly` 之外的選項：`downtime`、`scheduled_outage`、`write_freeze`。也可以反過來把既有的 `TENANT_UNAVAILABLE` 的 `reason: 'maintenance'` 改名（例：`schemaBehind`），但它已在 OpenAPI 的錯誤 `details`、指標標籤與重試判斷裡。傾向新功能避開，不改既有。
2. **「管理員」是誰**：租戶的角色可以自訂，沒有固定的「管理員」。方案：(a) 持有某個權限的人（`system:update`？`user:update`？）；(b) 系統角色 `super-admin` 的持有者；(c) 租戶在系統設定指定「平台通知的收件權限」。傾向 (a)，權限鍵待定。
3. **`scope = all` 怎麼推**：(a) 逐租戶各推一次 `t:{tenantId}`（租戶多時一則平台寫入變成上百則領域事件，都要經 `DomainEventRelay`）；(b) 新增一個所有租戶連線都加入的 room（例 `tenants`）；(c) 不推，前端每 N 分鐘重抓。傾向 (b)，但要確認不破壞「room 一律帶租戶」（[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D17）的原則——payload 只帶來源、不帶資料，風險在於受眾放寬。
4. **廣播全文放哪裡**：(a) 只存平台 DB，租戶網域新增 `GET /me/platform-messages/:broadcastId`，以「我有一則 `source_id` 等於它的通知」授權後讀平台 DB；(b) 在每個租戶 DB 存一份快照（類似 `announcement_dispatches`）。(a) 只有一份、撤回簡單；(b) 不必讓租戶的請求讀平台 DB。傾向 (a)。
5. **唯讀與其他提案共用**：[`tenant-lifecycle.md`](./tenant-lifecycle.md) 的唯讀停權是「租戶層、無期限」，本提案是「租戶層、有期限」，[`support-access.md`](./support-access.md) 是「某條 session 唯讀」。方案：(a) 一個 `TenantWriteRestriction`，來源有 `serviceWindow`、`lifecycle`，同一個 guard 與錯誤碼（`details.reason` 區分），support-access 另用 token 的範圍；(b) 各自實作。傾向 (a)，三份提案要一起定。
6. **唯讀時放行哪些寫入**：帳號流程之外，(a) 標通知已讀、個人偏好、`channel.relay`；(b) 背景工作（排程的公告、匯入的套用、`trash.purge`）要不要暫停；(c) 唯讀改成在 DB 層強制（`ALTER DATABASE … SET default_transaction_read_only`），連背景工作與稽核都寫不進去。傾向 guard ＋ 極小的放行清單、背景工作照常；(c) 太強，會擋掉登入時的 session 寫入。
7. **多語系**：平台管理者寫一份內容，收件人的語系各不相同。(a) 一份、由平台管理者自己寫雙語；(b) `title`／`body` 依語系各一份（zh-TW 必填、en-US 選填），橫幅與信依收件人的 `users.locale` 選。傾向 (b)。
8. **租戶能不能關掉 `platform.broadcast`**：(a) 不能（`mandatory`，平台的話一定要送到）；(b) 能，只有維護通知 `mandatory`。傾向 (b)：一般廣播被濫用時租戶要有退路。
9. **寄信的量與節流**：`audience = all` × 全部租戶可能是數萬封，`MAIL_JOB_OPTIONS` 每個程序 5 筆。方案：(a) 只允許 `audience = admins` 寄信；(b) 允許但另設佇列與每分鐘上限。傾向 (a)。
10. **`operator` 能不能送平台廣播**：維護時段是值班的事，`operator` 要能處理；廣播是對外發言，影響全部租戶。傾向只給 `super-admin`。
11. **apps/platform 的頁面位置**：側欄的「系統管理」（與稽核、背景工作、CDN 一起）或新群組。傾向「系統管理」。
12. **與既有 503 的互動**：維護期間真的停機（api 不在、或 migration 讓租戶落後）時，使用者看到的是 `TENANT_UNAVAILABLE` 或代理的錯誤頁，看不到橫幅。要不要讓前端記住最後一次取得的時段，在 503 時顯示「預定維護中，預計 … 結束」？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/`：新的一份「維護時段與平台廣播」（時段、唯讀、跨租戶的分批寫入、通知類型），設計決策放在最後
- [`05-tenancy.md`](../architecture/05-tenancy.md)：唯讀與 `TENANT_UNAVAILABLE` 的區分、§3 的新元件
- [`backend/15-notification.md`](../architecture/backend/15-notification.md) §4、[`backend/16-notification-event.md`](../architecture/backend/16-notification-event.md) §1.3：兩種新類型
- [`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §3.6、§6.1、§9：新來源與 room
- `docs/architecture/frontend/`：橫幅寫進 [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) 或外框的章節；apps/platform 的頁面寫進 [`apps/platform/README.md`](../../apps/platform/README.md)
- [`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8：平台權限鍵

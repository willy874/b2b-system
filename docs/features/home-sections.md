# 首頁區塊

- 優先度：P1
- 狀態：提案
- 依賴：首頁區塊的註冊表（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4.7）；站內通知（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §12.2 D8、D9，[`frontend/15-notification.md`](../architecture/frontend/15-notification.md) §6）；
  匯入／匯出（[`frontend/21-data-transfer.md`](../architecture/frontend/21-data-transfer.md) §5）；背景工作的管理 API（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §6）；
  公告的通知（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §6、§9.2 D4）；授權的說明（[`iam/08-explain.md`](../architecture/iam/08-explain.md) §5）
- 相關：審批的首頁待辦（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §11.1、§12.2 D2、D3）；推播的跨程序轉送（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7.6）；
  [`platform-dashboard.md`](./platform-dashboard.md)（apps/platform 的總覽，與本提案互不依賴）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

首頁區塊的註冊表（`apps/backstage/src/core/home/registry.ts:29` 的 `registerHomeSection`）已經做好，但只有審批登記了一個區塊
（`features/approval/home.ts:16`，「待我審核」，`order: 100`）。其他「有事等你處理」的資訊都要使用者自己去找：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 有未讀的通知（被指派角色、匯出完成、留言提及） | 頂列鈴鐺的徽章，點開 Popover 才看得到內容 | 首頁沒有任何提示；登入後第一眼看不到「發生了什麼」 |
| 我送出的匯入或匯出還在跑 | 帳號選單 →「我的匯入匯出」（`/data-transfer`） | 入口藏在帳號選單裡；回到首頁就不知道它還在跑 |
| 租戶的背景工作失敗（重試用完、停在 `failed`） | 側欄「背景工作」，自己篩選狀態 | 有 `job:read` 的管理者不會主動去看；失敗的工作保留期一到（預設 7 天，高流量 1 天）就被清掉 |
| 公司發了公告 | 一則 `announcement.published` 通知，混在其他通知裡 | 已讀之後就沉下去；沒有「最近的公告」可以回頭看 |
| 想知道自己為什麼有某個權限 | 首頁「你的權限」只顯示數字（`features/home/pages/Home/page.tsx:39-42`，`data.permissions.length`） | 數字不能點；說明在個人資料頁的「我的有效權限」（`features/account/pages/Profile/components/ProfilePermissionSection.tsx`），首頁沒有連過去 |

`<HomeSections>`（`core/home/HomeSections.tsx`）依 `order` 排序、以單一 `pageKey` 過濾、每個區塊各包 `<Suspense>`；
區塊沒有內容時自己回傳 `null`。可啟用的 feature 卸載時，plugin 的 `clearup` 會撤回它登記的區塊（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §3、§9.2 D4）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 四個新區塊：未讀通知、我進行中的匯入匯出、失敗的背景工作、近期公告；各由擁有的 feature 登記（§1） | 首頁直接 import 任何 feature 的元件（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §12.3「評估過的方案」） |
| 補不足的查詢：通知依類型篩選、背景工作的時間範圍（§2） | 使用者自己排序或隱藏區塊（見開放問題 6） |
| 失敗的背景工作改由推播更新（§3） | 輪詢（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §12.2 D3：徽章與待辦靠推播失效 ＋ 視窗聚焦重查） |
| 首頁「你的權限」的數字可點，打開有效權限的對話框（§4） | 「為什麼 **不能**」（[`iam/08-explain.md`](../architecture/iam/08-explain.md) §6） |
| | apps/platform 的首頁（另見 [`platform-dashboard.md`](./platform-dashboard.md)）；把 `core/home` 搬進 web-core（§4.7：第二個前端也需要時再搬） |
| | 管理端的公告概況（排程中、已讀率）：在公告頁，不上首頁 |

## 使用者故事

**作為一般使用者，我希望登入後在首頁看到還沒讀的通知與最近的公告，以便不必逐一點開鈴鐺與列表。**

- **Given** 我有 4 則未讀通知，其中 1 則是 2 天前的公告
- **When** 我打開首頁
- **Then** 「未讀通知」區塊顯示「4 則未讀」與最新的 3 則（不含公告）；「近期公告」顯示那則公告的標題與時間，點下去是全文頁；在鈴鐺標為已讀後兩個區塊即時更新

**作為送出匯出的人，我希望在首頁看到它的進度，以便不必到帳號選單裡找。**

- **Given** 我送出的匯出正在 `running`
- **When** 我回到首頁
- **Then** 「進行中的匯入匯出」列出它的類型、資源與進度；完成時（推播）從區塊消失，通知區塊多一則「匯出完成」

**作為有 `job:read` 的租戶管理者，我希望首頁提醒我最近失敗的背景工作，以便在保留期過之前處理。**

- **Given** 今天有 12 筆 `webhook.deliver` 重試用完、停在 `failed`
- **When** 我打開首頁（或首頁已開著時又多一筆失敗）
- **Then** 「失敗的背景工作」顯示筆數與最新 3 筆的工作名稱與時間，「查看全部」連到 `/job?state=failed`；沒有 `job:read` 或 `job` feature 未啟用的人看不到這個區塊

## 初步構想

### 1. 區塊（都在 `apps/backstage`，每個 feature 一個 `home.ts`，plugin 同步階段登記）

| key | 登記的 feature | `pageKey` | `order` | 內容 | 沒有內容時 |
| --- | --- | --- | --- | --- | --- |
| `pending-approvals`（既有） | `approval` | `MY_APPROVAL_PAGE` | 100 | 不變 | — |
| `my-data-transfers` | `data-transfer`（可啟用） | `DATA_TRANSFER_PAGE`（只需登入） | 200 | 自己的 `queued`／`running`／`applying` 傳輸，最多 5 筆；類型、資源、進度、取消；「全部」連 `/data-transfer` | `null` |
| `failed-jobs` | `job`（可啟用） | `JOB_PAGE`（`job:read`） | 300 | 失敗筆數 ＋ 最新 3 筆（工作名稱、時間，連到詳情）；`job:retry` 時列尾有重試 | `null` |
| `unread-notifications` | `notification` | `NOTIFICATION_PAGE`（只需登入） | 400 | 未讀數 ＋ 最新 3 則未讀（沿用 `NotificationItem` 與詳細內容對話框、標為已讀）；「全部」連 `/notification?filter=unread` | `null` |
| `recent-announcements` | `announcement`（可啟用） | `ANNOUNCEMENT_MESSAGE_PAGE`（只需登入） | 500 | 最近 14 天收到的公告，最多 3 則：標題、時間、未讀標記，連到 `announcement.message` | `null` |

- 順序依「要我動手」→「要我知道」：審批、自己的傳輸、失敗的工作、通知、公告。
- `data-transfer` 沒有自己的語系包（字串在 web-core 的 `dataTransfer`），`localeScope` 填 web-core 的 scope；其餘填各自 feature 的 scope。
- 區塊的外框（標題、「查看全部」、清單）四個都一樣：在 `@b2b-system/ui` 加一個不帶業務名詞的 `SummaryCard`，或照審批的區塊各自寫（開放問題 5）。

### 2. 查詢：既有的夠不夠

| 區塊 | 既有 API | 結論 |
| --- | --- | --- |
| 未讀通知 | `GET /notifications/unread-count`、`GET /notifications?unread=true&limit=3` | **夠**。要排除公告時見下一列的 `type` |
| 近期公告 | 收件人只有 `GET /me/announcement-messages/:dispatchId`（單筆全文）；`GET /notifications` 沒有類型篩選；`GET /notifications/all` 有 `type` 但要 `notification:read` | **不足**：見開放問題 1 |
| 我的匯入匯出 | `GET /data-transfers?status=queued&status=running&status=applying&limit=5`（只回自己的，`createdBy = userId`） | **夠** |
| 失敗的背景工作 | `GET /jobs?state=failed&limit=3`（`created_on DESC`，回 `total`） | 筆數與清單夠；要「最近 24 小時」得在 `ListJobSchema` 加 `finishedFrom`（`completed_on >=`，開放問題 3） |
| 權限說明 | `GET /users/:id/permission-sources`（查自己不需要權限） | **夠** |

### 3. 推播

| 區塊 | 失效來源 | 要補的 |
| --- | --- | --- |
| 未讀通知、近期公告 | `notification` create／update（只推給收件人，`ChangeSource.NOTIFICATION`）；公告送達本來就是一則通知 | 區塊的 query key 放進 `Resource.NOTIFICATION` 的 `collection`（`apis/resources.ts`）；撤回推的 `delete` 同樣讓它重抓 |
| 我的匯入匯出 | `dataTransfer`（只推給建立者，含進度） | 沿用 `DATA_TRANSFER_LIST_QUERY_KEY` 的前綴，不必改 |
| 失敗的背景工作 | **沒有**：租戶的工作沒有 `ChangeSource`，`Resource.JOB` 只有本分頁的重試會宣告 | 新增 `ChangeSource.JOB`（受眾 `job:read`，`recordsAudit: false`）：`JobQueue` 在一筆工作結束為 `failed` 時發；worker 程序經 `DomainEventRelay` 轉送。同一個租戶 10 秒內只推一次（開放問題 4） |

### 4. 「你的權限」連到說明

- 數字改成按鈕（「N 個權限」），打開 `core/components/ExplainPath` 的 `PermissionSourceDialog`，query 用 `apis/user/get-user-permission-sources`（`data.user.id`），**打開時才查**，與個人資料頁相同。
- `core/` 與 `apis/` 本來就能被 feature 使用，`features/home` 不 import `features/account`。另一個做法是連到個人資料頁並自動打開，見開放問題 7。

### 5. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/backstage/src/features/{data-transfer,job,notification,announcement}/home.ts`（新）、`plugin.ts`、`components/*Section.tsx` | §1 的四個區塊 |
| `apps/backstage/src/features/home/pages/Home/page.tsx`、`features/home/locales/*.json` | §4 |
| `apps/backstage/src/apis/resources.ts`、`apis/notification/`、`apis/job/get-job-list/` | §2、§3 的 query key 與參數 |
| `apps/api/src/modules/notification/dto/notification.dto.ts` 或 `modules/announcement/announcement-message.controller.ts` | 開放問題 1 的結論 |
| `apps/api/src/modules/job/dto/job.dto.ts`、`core/jobs/job-store.ts`、`core/jobs/job-queue.ts` | `finishedFrom`；失敗時發事件 |
| `packages/realtime`（`ChangeSource.JOB`）、`apps/api/src/modules/realtime/realtime.audience.ts` | §3 |
| E2E：`apps/e2e` 的首頁 | 四個區塊的出現與消失、feature 停用時區塊消失 |

## 開放問題

1. **近期公告從哪裡查？** (a) `GET /notifications` 加 `type`（可重複）篩選：沿用收件人的索引 `(recipient_id, created_at, id)`，每人最多 `notification.maxPerUser`（500）則，篩類型的掃描有上限；
   (b) 公告模組新增 `GET /me/announcement-messages?limit=`，以 `notifications.source_id` 對到發送紀錄，回標題、時間、已讀。
   傾向 (b)：屬於 `announcement`，feature 停用時跟著 `FEATURE_DISABLED`；(a) 讓通知模組的 API 帶上業務類型的篩選。未讀通知區塊要不要排除公告也看這一條的結論。
2. **`pageKey` 只有一個頁面鍵，不夠表達的條件怎麼辦？** 例：近期公告也取決於租戶有沒有在事件管理關掉 `announcement.published`；失敗工作的「重試」要 `job:retry`；審批既有的區塊在元件裡另判 `approval:review`。
   (a) 維持單一 `pageKey`，細的條件在區塊裡判斷、沒有內容就回 `null`；(b) `HomeSection` 加選用的 `visible(can)`。傾向 (a)：與審批一致，(b) 只省一次空查詢。
3. **失敗的工作顯示多久的？** (a) 保留期內全部（`failed` 不重試就一直在，高流量的工作 1 天、其餘 7 天）；(b) 最近 24 小時，要加 `finishedFrom` 並確認 `pgboss.job` 的查詢走得到索引。
   傾向 (b)：預期會失敗的工作（例：接收端已下線的 Webhook）不該在首頁掛一週。
4. **失敗工作的推播會不會太多？** 外部服務停擺時一小時可能上千筆 `failed`。(a) 每筆都推；(b) 同一個租戶節流（10 秒一次，只送訊號）；(c) 不推，只靠視窗聚焦重查。傾向 (b)。
5. **區塊的外框要不要抽成元件？** 五個區塊都是「標題 ＋ 筆數 ＋ 最多 N 筆 ＋ 查看全部」。(a) `@b2b-system/ui` 加 `SummaryCard`（不帶業務名詞）；(b) 照審批的寫法各自寫。傾向 (a)，審批的區塊一起改用。
6. **區塊多了之後的版面與個人化**：五個區塊直排會把個人資訊推到很下面。(a) 改成兩欄的格線（`HomeSections` 的版面）；(b) 讓使用者在偏好頁隱藏或排序（同頂列工具，[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4.4）。傾向這一版只做 (a)，(b) 等有人要再做。
7. **權限數字點了去哪？** (a) 首頁直接開 `PermissionSourceDialog`；(b) 用 `<RouteLink to="account.profile">` 連到個人資料頁並自動打開（profile 要加 search 參數）。傾向 (a)：少一次換頁，元件與 API 都在共用層。
8. **未讀通知與既有入口重複**：鈴鐺已有未讀數，審批的通知也已經在「待我審核」。要不要排除 `approval.pending`？傾向不排除：通知是「發生了什麼」，待辦是「還要做什麼」，標為已讀的時機不同。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/frontend/02-plugin-system.md` §4.7：登記的區塊清單、`order` 的配置、版面
- `docs/architecture/frontend/15-notification.md`、`frontend/16-announcement.md`、`frontend/21-data-transfer.md`：各自的首頁區塊與快取失效
- `docs/architecture/backend/10-jobs.md` §6：`finishedFrom`、失敗的推播；`backend/08-realtime.md` §6.1：`ChangeSource.JOB`
- `docs/architecture/backend/19-announcement.md` 或 `backend/15-notification.md`：開放問題 1 的查詢
- `docs/architecture/iam/08-explain.md` §5：首頁的入口
